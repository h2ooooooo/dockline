import {describe, expect, it, vi} from 'vitest';
import {Readable, Writable} from 'node:stream';
import {FTPError} from 'basic-ftp';
import {AuthError as SharedAuthError} from '@dockline/abstract';
import {FtpConnector} from '../src/FtpConnector.js';
import {AuthError, PermissionError, OperationAbortedError, OperationTimeoutError, ConnectionClosedError} from '../src/errors.js';

const config = {
    host: 'unused',
    port: 21,
    user: 'fixture',
    password: 'fixture-password',
    secure: false,
    initialPath: '/deployment',
    passive: true,
};
const timeout = () => Object.assign(new Error('Synthetic timeout'), {code: 'ETIMEDOUT'});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function controlled(options = {}) {
    const connector = new FtpConnector({...config, ...options});
    const state = connector as any;

    state.ensureConnected = vi.fn(async () => {});

    return {connector, state, client: state.client};
}

function connecting(options = {}) {
    const connector = new FtpConnector({...config, ...options});
    const state = connector as any;
    const client = state.client;
    let closed = true;

    Object.defineProperty(client, 'closed', {get: () => closed, configurable: true});
    client.close = vi.fn(() => {
        closed = true;
    });
    client.connect = vi.fn(async () => {
        closed = false;
    });
    client.sendIgnoringError = vi.fn(async () => {});
    client.login = vi.fn(async () => {});
    client.useDefaultSettings = vi.fn(async () => {});
    client.cd = vi.fn(async () => {});
    state.createClient = () => client;

    return {connector, state, client};
}

async function drain(stream: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream as Readable) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

describe('FTP audited session state', () => {
    it('restores cwd after partial mkdir failure before a relative write', async () => {
        const {connector, client} = controlled();
        let cwd = '/deployment';
        let uploaded = '';

        client.pwd = async () => cwd;
        client.ensureDir = async () => {
            cwd = '/deployment/nested';

            throw new PermissionError('Denied');
        };

        client.cd = vi.fn(async (path: string) => {
            cwd = path;
        });
        client.uploadFrom = async (_source: Readable, path: string) => {
            uploaded = `${cwd}/${path}`;
        };

        await expect(connector.createDirectory('nested/denied', {})).rejects.toBeInstanceOf(PermissionError);
        await connector.write('next.txt', Readable.from(['ok']), {});
        expect(uploaded).toBe('/deployment/next.txt');
    });

    it('invalidates a session when cwd restoration fails and preserves the original failure', async () => {
        const {connector, state, client} = controlled();

        client.pwd = async () => '/deployment';
        client.ensureDir = async () => {
            throw new PermissionError('Creation denied');
        };

        client.cd = async () => {
            throw new Error('Restoration denied');
        };

        client.close = vi.fn();
        state.connected = true;
        await expect(connector.createDirectory('nested/denied', {})).rejects.toThrow('Creation denied');
        expect(client.close).toHaveBeenCalledOnce();
        expect(state.connected).toBe(false);
    });

    it('never restores cwd from an abandoned attempt after newer work begins', async () => {
        const {connector, client} = controlled();
        let finish!: () => void;

        client.pwd = async () => '/deployment';
        client.ensureDir = () => new Promise<void>(resolve => {
            finish = resolve;
        });
        client.cd = vi.fn(async () => {});
        client.uploadFrom = vi.fn(async () => {});
        await expect(connector.createDirectory('nested', {timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        await connector.write('newer.txt', Readable.from(['newer operation']), {});
        finish();
        await tick();
        expect(client.cd).not.toHaveBeenCalled();
        expect(client.uploadFrom).toHaveBeenCalledOnce();
    });

    it('uses one underlying connection for simultaneous lazy calls', async () => {
        const {connector, client} = connecting();

        client.list = vi.fn(async () => []);
        await Promise.all([connector.directoryExists('/', {}), connector.directoryExists('.', {}), connector.connect()]);
        expect(client.connect).toHaveBeenCalledOnce();
        expect(client.cd).toHaveBeenCalledWith('/deployment');
    });

    it('blocks automatic reuse of a lost established session unless enabled', async () => {
        const {connector, client} = connecting();

        client.list = vi.fn(async () => []);
        await connector.connect();
        client.close();
        await expect(connector.directoryExists('/', {})).rejects.toBeInstanceOf(ConnectionClosedError);
        expect(client.connect).toHaveBeenCalledTimes(1);
        await expect(connector.directoryExists('/', {autoReconnect: true})).resolves.toBe(true);
        expect(client.connect).toHaveBeenCalledTimes(2);
        await connector.disconnect();
        await connector.connect();
        expect(client.connect).toHaveBeenCalledTimes(3);
    });

    it('cancels a pending connection and prevents stale completion from reconnecting', async () => {
        const {connector, state, client} = connecting();
        let finish!: () => void;

        client.connect = vi.fn(() => new Promise<void>(resolve => {
            finish = resolve;
        }));

        const pending = connector.connect();
        const failure = expect(pending).rejects.toBeInstanceOf(OperationAbortedError);

        await tick();
        await connector.disconnect();
        await failure;
        finish();
        await tick();
        expect(state.connected).toBe(false);
    });
});

describe('FTP directory stat', () => {
    it('recognizes root/current/trailing-slash directories and preserves listing failures', async () => {
        const {connector, client} = controlled();

        client.list = vi.fn(async () => [{name: 'child', isDirectory: true}, {name: 'file.txt', isFile: true}]);

        for (const path of [
            '/',
            '.',
            '',
            'child/',
            'child//',
        ]) {
            await expect(connector.directoryExists(path, {})).resolves.toBe(true);
        }

        await expect(connector.directoryExists('file.txt/', {})).resolves.toBe(false);
        await expect(connector.directoryExists('absent', {})).resolves.toBe(false);
        client.list = async () => {
            throw new PermissionError('Listing denied');
        };

        await expect(connector.directoryExists('/', {})).rejects.toBeInstanceOf(PermissionError);
    });
});

describe('FTP retry budgets and cancellation', () => {
    it('allows three additional initial connection attempts by default', async () => {
        const {connector, client} = connecting();

        client.connect = vi.fn(async () => {
            throw timeout();
        });
        await expect(connector.connect()).rejects.toThrow('Synthetic timeout');
        expect(client.connect).toHaveBeenCalledTimes(4);
    });

    it('honors global and per-call retry overrides including zero', async () => {
        const {connector, client} = connecting({maxTransientRetries: 1});

        client.connect = vi.fn(async () => {
            throw timeout();
        });
        await expect(connector.connect()).rejects.toThrow();
        expect(client.connect).toHaveBeenCalledTimes(2);
        client.connect.mockClear();
        await expect(connector.connect({maxTransientRetries: 0})).rejects.toThrow();
        expect(client.connect).toHaveBeenCalledTimes(1);
    });

    it('does not retry rejected authentication', async () => {
        const {connector, client} = connecting({autoReconnect: true});

        client.connect = vi.fn(async () => {
            throw new FTPError({code: 530, message: 'Login denied'});
        });
        await expect(connector.connect()).rejects.toBeInstanceOf(AuthError);
        expect(client.connect).toHaveBeenCalledOnce();
    });

    it('retries transient metadata failures when enabled, but not permissions', async () => {
        const {connector, client} = controlled({autoReconnect: true, maxTransientRetries: 2});

        client.list = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue([]);
        await expect(connector.directoryExists('/', {})).resolves.toBe(true);
        expect(client.list).toHaveBeenCalledTimes(2);
        client.list = vi.fn(async () => {
            throw new PermissionError('Denied');
        });
        await expect(connector.directoryExists('/', {})).rejects.toBeInstanceOf(PermissionError);
        expect(client.list).toHaveBeenCalledOnce();
    });

    it('retries per-attempt metadata timeouts with a fresh deadline', async () => {
        const {connector, client} = controlled({autoReconnect: true, maxTransientRetries: 1});

        client.list = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([]);
        await expect(connector.directoryExists('/', {timeoutMs: 20})).resolves.toBe(true);
        expect(client.list).toHaveBeenCalledTimes(2);
    });

    it('never replays a started upload or ambiguous mutation', async () => {
        const {connector, client} = controlled({autoReconnect: true});

        client.uploadFrom = vi.fn(async (source: Readable) => {
            await drain(source);

            throw timeout();
        });
        await expect(connector.write('file.txt', Readable.from(['one shot']), {})).rejects.toThrow();
        expect(client.uploadFrom).toHaveBeenCalledOnce();
        client.remove = vi.fn(async () => {
            throw timeout();
        });
        await expect(connector.deleteFile('file.txt', {})).rejects.toThrow();
        expect(client.remove).toHaveBeenCalledOnce();
    });

    it('retries explicitly replayable uploads with a fresh stream after a transient failure', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const streams: Readable[] = [];
        const factory = vi.fn(() => {
            const source = Readable.from(['repeatable bytes']);

            streams.push(source);

            return source;
        });
        const payloads: string[] = [];

        client.uploadFrom = vi.fn(async (source: Readable) => {
            payloads.push((await drain(source)).toString());

            if (payloads.length === 1) {
                throw timeout();
            }
        });
        await connector.write('file.txt', factory, {});
        expect(factory).toHaveBeenCalledTimes(2);
        expect(streams[0]).not.toBe(streams[1]);
        expect(streams[0].destroyed).toBe(true);
        expect(payloads).toEqual(['repeatable bytes', 'repeatable bytes']);
    });

    it('does not replay upload factories on permission errors or without opt-in', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const factory = vi.fn(() => Readable.from(['payload']));

        client.uploadFrom = vi.fn(async () => {
            throw new PermissionError('Denied');
        });
        await expect(connector.write('file', factory, {})).rejects.toBeInstanceOf(PermissionError);
        expect(factory).toHaveBeenCalledOnce();
        factory.mockClear();
        client.uploadFrom = vi.fn(async () => {
            throw timeout();
        });
        await expect(connector.write('file', factory, {autoReconnect: false})).rejects.toThrow();
        expect(factory).toHaveBeenCalledOnce();
    });

    it('rejects a replay factory returning the same stream twice', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const source = new Readable({read() {}});

        client.uploadFrom = vi.fn(async () => {
            throw timeout();
        });
        await expect(connector.write('file', () => source, {})).rejects.toThrow('fresh, unread stream');
        expect(client.uploadFrom).toHaveBeenCalledOnce();
    });

    it('rejects a partially consumed factory source before opening the destination', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const source = Readable.from(['prefix', 'remaining'], {autoDestroy: false});

        expect(source.read()).toBe('prefix');
        expect(source.readableDidRead).toBe(true);
        expect(source.readableEnded).toBe(false);
        client.uploadFrom = vi.fn();
        await expect(connector.write('file', () => source, {})).rejects.toThrow('fresh, unread stream');
        expect(client.uploadFrom).not.toHaveBeenCalled();
        expect(source.destroyed).toBe(true);
    });

    it('preserves remaining-stream semantics for a one-shot source', async () => {
        const {connector, client} = controlled();
        const source = Readable.from(['prefix', 'remaining'], {autoDestroy: false});

        expect(source.read()).toBe('prefix');

        let payload = '';

        client.uploadFrom = vi.fn(async (input: Readable) => {
            payload = (await drain(input)).toString();
        });
        await connector.write('file', source, {});
        expect(payload).toBe('remaining');
        expect(client.uploadFrom).toHaveBeenCalledOnce();
    });

    it('rejects a pre-aborted call before connecting or uploading', async () => {
        const {connector, state, client} = controlled();

        client.uploadFrom = vi.fn();
        await expect(connector.write('file', Readable.from(['x']), {abortSignal: AbortSignal.abort()})).rejects.toBeInstanceOf(OperationAbortedError);
        expect(state.ensureConnected).not.toHaveBeenCalled();
        expect(client.uploadFrom).not.toHaveBeenCalled();
    });

    it('aborts an active write, destroys its source, and never retries', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const controller = new AbortController();
        const source = new Readable({read() {}});

        client.uploadFrom = vi.fn(() => new Promise(() => {}));

        const pending = connector.write('file', source, {abortSignal: controller.signal});
        const failure = expect(pending).rejects.toBeInstanceOf(OperationAbortedError);

        await tick();
        controller.abort();
        await failure;
        expect(source.destroyed).toBe(true);
        expect(client.uploadFrom).toHaveBeenCalledOnce();
    });

    it('does not replay a timed-out upload and supports the direct timeout alias', async () => {
        const {connector, client} = controlled({autoReconnect: true});
        const source = new Readable({read() {}});

        client.uploadFrom = vi.fn(() => new Promise(() => {}));
        await expect(connector.write('file', source, {timeout: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(source.destroyed).toBe(true);
        expect(client.uploadFrom).toHaveBeenCalledOnce();
    });

    it('cancels queued work without interrupting the active operation', async () => {
        const {connector, client} = controlled();
        let finish!: () => void;

        client.remove = vi.fn(() => new Promise<void>(resolve => {
            finish = resolve;
        }));
        client.list = vi.fn(async () => []);

        const active = connector.deleteFile('file', {});

        await tick();

        const controller = new AbortController();
        const queued = connector.directoryExists('/', {abortSignal: controller.signal});
        const failure = expect(queued).rejects.toBeInstanceOf(OperationAbortedError);

        controller.abort();
        await failure;
        expect(client.list).not.toHaveBeenCalled();
        finish();
        await active;
        await expect(connector.directoryExists('/', {})).resolves.toBe(true);
    });
});

describe('FTP stream lifetime owns the command queue', () => {
    it('keeps later commands queued through the final response and consumer drain', async () => {
        const {connector, client} = controlled();
        let finish!: () => void;

        client.downloadTo = vi.fn(async (destination: Writable) => {
            destination.end('payload');
            await new Promise<void>(resolve => {
                finish = resolve;
            });
        });
        client.list = vi.fn(async () => []);

        const stream = await connector.read('/file', {}) as Readable;
        const metadata = connector.directoryExists('/', {});

        await tick();
        expect(client.list).not.toHaveBeenCalled();
        finish();
        await tick();
        expect(client.list).not.toHaveBeenCalled();
        expect((await drain(stream)).toString()).toBe('payload');
        await metadata;
        expect(client.list).toHaveBeenCalledOnce();
    });

    it('releases a cancelled read and closes its transport', async () => {
        const {connector, state, client} = controlled();

        client.close = vi.fn();
        client.downloadTo = vi.fn(() => new Promise(() => {}));
        client.list = vi.fn(async () => []);

        const stream = await connector.read('/file', {}) as Readable;

        stream.destroy();
        await tick();
        expect(client.close).toHaveBeenCalled();
        expect(state.connected).toBe(false);
        await expect(connector.directoryExists('/', {})).resolves.toBe(true);
    });
});

describe('FTP shared API identity', () => {
    it('re-exports the exact shared runtime error constructors', () => {
        expect(new AuthError('Rejected')).toBeInstanceOf(SharedAuthError);
        expect(AuthError).toBe(SharedAuthError);
    });
});
