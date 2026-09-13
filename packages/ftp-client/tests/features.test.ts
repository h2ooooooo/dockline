import {afterEach, describe, expect, it, vi} from 'vitest';
import {Readable, Writable} from 'node:stream';
import {FTPError} from 'basic-ftp';
import type {CredentialContext} from '@jalsoedesign/dockline-abstract';
import {FtpConnector, type FtpConnectorConfig} from '../src/FtpConnector.js';
import {resolveFilenameEncoding, validateFilename} from '../src/filename-encoding.js';
import {
    AuthError, CredentialProviderError, DirectoryAccessError, NameResolutionError,
    ConnectionRefusedError, TlsTrustError, NotSupportedError, OperationAbortedError, OperationTimeoutError,
} from '../src/errors.js';

const config: FtpConnectorConfig = {
    host: 'fixture.invalid',
    port: 21,
    user: 'public-user',
    password: 'public-password',
    secure: false,
    initialPath: '/deployment',
    passive: true,
    maxTransientRetries: 0,
};
const cleanup: FtpConnector[] = [];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

afterEach(async () => {
    for (const connector of cleanup.splice(0)) {
        await connector.disconnect();
    }

    vi.useRealTimers();
});

function fixture(options: Partial<FtpConnectorConfig> = {}) {
    const connector = new FtpConnector({...config, ...options});
    const internal = connector as any;
    const client = internal.client;
    let closed = true;

    cleanup.push(connector);
    Object.defineProperty(client, 'closed', {get: () => closed, configurable: true});
    client.close = vi.fn(() => {
        closed = true;
    });
    client.connect = vi.fn(async () => {
        closed = false;
    });
    client.connectImplicitTLS = client.connect;
    client.login = vi.fn(async () => {});
    client.useTLS = vi.fn(async () => {});
    client.useDefaultSettings = vi.fn(async () => {});
    client.sendIgnoringError = vi.fn(async () => ({code: 200}));
    client.send = vi.fn(async () => ({code: 200}));
    client.cd = vi.fn(async () => {});
    client.list = vi.fn(async () => []);
    internal.createClient = () => client;

    return {connector, internal, client};
}

async function drain(stream: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream as Readable) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

describe('FTP typed connection stages', () => {
    it.each([
        ['ENOTFOUND', NameResolutionError, 'resolve'],
        ['ECONNREFUSED', ConnectionRefusedError, 'connect'],
        ['CERT_HAS_EXPIRED', TlsTrustError, 'trust'],
    ])('classifies %s without leaking credentials', async (code, ErrorType, stage) => {
        const {connector, client} = fixture();

        client.connect.mockRejectedValue(Object.assign(new Error(`Failed with ${config.password}`), {code}));

        const failure = await connector.connect().catch(error => error);

        expect(failure).toBeInstanceOf(ErrorType);
        expect(failure.stage).toBe(stage);
        expect(failure.message).not.toContain(config.password);
        expect(failure.cause).toBeUndefined();
    });

    it('distinguishes authentication and initial directory failures', async () => {
        const {connector, client} = fixture();

        client.login.mockRejectedValueOnce(new FTPError({code: 530, message: 'Rejected'}));
        await expect(connector.connect()).rejects.toMatchObject({name: 'AuthError', stage: 'authenticate'});
        client.cd.mockRejectedValueOnce(new FTPError({code: 550, message: 'Directory inaccessible'}));
        await expect(connector.connect()).rejects.toBeInstanceOf(DirectoryAccessError);
    });

    it('classifies explicit TLS rejection separately from login', async () => {
        const {connector, client} = fixture({secure: true});

        client.useTLS.mockRejectedValue(Object.assign(new Error('Unknown CA'), {code: 'DEPTH_ZERO_SELF_SIGNED_CERT'}));
        await expect(connector.connect()).rejects.toBeInstanceOf(TlsTrustError);
        expect(client.login).not.toHaveBeenCalled();
    });
});

describe('FTP credentials at the connection boundary', () => {
    it('requests credentials per connection with identity, purpose and no serialization leak', async () => {
        const credentialProvider = vi.fn(async (_context: CredentialContext) => ({type: 'password' as const, password: 'vault-value', username: 'vault-user'}));
        const {connector, client} = fixture({credentialProvider, siteId: 'Production/site', autoReconnect: true});

        await connector.connect();
        await connector.directoryExists('.', {});
        expect(credentialProvider).toHaveBeenCalledOnce();
        expect(credentialProvider.mock.calls[0][0]).toMatchObject({
            siteId: 'Production/site',
            host: config.host,
            port: 21,
            protocol: 'ftp',
            purpose: 'connect',
            attempt: 1,
        });
        expect(client.login).toHaveBeenCalledWith('vault-user', 'vault-value');
        expect(JSON.stringify(connector)).not.toContain('vault-value');
        client.close();
        await connector.directoryExists('.', {});
        expect(credentialProvider).toHaveBeenCalledTimes(2);
        expect(credentialProvider.mock.calls[1][0]).toMatchObject({purpose: 'reconnect', attempt: 1});
    });

    it('sanitizes provider rejection and never retries interactive providers', async () => {
        const credentialProvider = vi.fn(async () => {
            throw new Error('vault-sensitive-value');
        });
        const {connector, client} = fixture({credentialProvider, maxTransientRetries: 3, autoReconnect: true});
        const failure = await connector.connect().catch(error => error);

        expect(failure).toBeInstanceOf(CredentialProviderError);
        expect(JSON.stringify(failure)).not.toContain('vault-sensitive-value');
        expect(failure.message).not.toContain('vault-sensitive-value');
        expect(credentialProvider).toHaveBeenCalledOnce();
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('aborts a waiting provider on disconnect and prevents late authentication', async () => {
        let finish!: (value: {type: 'password'; password: string}) => void;
        let providerSignal: AbortSignal | undefined;
        const {connector, client} = fixture({
            credentialProvider: context => {
                providerSignal = context.abortSignal;

                return new Promise(resolve => {
                    finish = resolve;
                });
            },
        });
        const pending = connector.connect();
        const failure = expect(pending).rejects.toBeInstanceOf(OperationAbortedError);

        await tick();
        await connector.disconnect();
        await failure;
        expect(providerSignal?.aborted).toBe(true);
        finish({type: 'password', password: 'late-secret'});
        await tick();
        expect(client.login).not.toHaveBeenCalled();
        expect(client.connect).not.toHaveBeenCalled();
    });

    it('forwards a deadline to the provider and rejects unsupported material', async () => {
        let providerSignal: AbortSignal | undefined;
        const {connector} = fixture({
            credentialProvider: context => {
                providerSignal = context.abortSignal;

                return new Promise(() => {});
            },
        });

        await expect(connector.connect({timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(providerSignal?.aborted).toBe(true);

        const unsupported = fixture({credentialProvider: async () => ({type: 'agent', socketPath: 'agent.sock'})});

        await expect(unsupported.connector.connect()).rejects.toBeInstanceOf(CredentialProviderError);
    });

    it('redacts resolved provider secrets from transport failures', async () => {
        const {connector, client} = fixture({
            credentialProvider: async () => ({type: 'password', password: 'provider-secret'}),
        });

        client.login.mockRejectedValue(new FTPError({code: 530, message: 'Rejected provider-secret'}));

        const failure = await connector.connect().catch(error => error);

        expect(failure).toBeInstanceOf(AuthError);
        expect(failure.message).not.toContain('provider-secret');
    });
});

describe('FTP idle keepalive and state observation', () => {
    it('sends idle NOOPs, skips active work and clears the timer on disconnect', async () => {
        vi.useFakeTimers();

        const states: string[] = [];
        const {connector, client} = fixture({
            keepalive: {intervalMs: 1000},
            onConnectionState: event => {
                states.push(event.state);
            },
        });

        await connector.connect();
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.send).toHaveBeenCalledExactlyOnceWith('NOOP');

        let release!: () => void;

        client.list = vi.fn(() => new Promise<void>(resolve => {
            release = resolve;
        }).then(() => []));

        const active = connector.directoryExists('.', {});

        await vi.advanceTimersByTimeAsync(5000);
        expect(client.send).toHaveBeenCalledTimes(1);
        release();
        await active;
        await vi.advanceTimersByTimeAsync(1000);
        expect(client.send).toHaveBeenCalledTimes(2);
        await connector.disconnect();
        await vi.advanceTimersByTimeAsync(5000);
        expect(client.send).toHaveBeenCalledTimes(2);
        expect(states).toEqual(['connecting', 'ready', 'disconnected']);
    });

    it('stops after the missed-probe threshold and reconnects only on foreground demand', async () => {
        vi.useFakeTimers();

        const states: string[] = [];
        const {connector, client} = fixture({
            autoReconnect: true,
            keepalive: {intervalMs: 1000, maxMissed: 2},
            onConnectionState: event => {
                states.push(event.state);
            },
        });

        await connector.connect();
        client.send.mockRejectedValue(new FTPError({code: 500, message: 'Probe rejected'}));
        await vi.advanceTimersByTimeAsync(5000);
        expect(client.send).toHaveBeenCalledTimes(2);
        expect(client.connect).toHaveBeenCalledOnce();
        expect(states.filter(state => state === 'failed')).toHaveLength(1);
        client.send.mockResolvedValue({code: 200});
        await connector.directoryExists('.', {});
        expect(client.connect).toHaveBeenCalledTimes(2);
        expect(states).toContain('reconnecting');
    });

    it('isolates observational callback errors from authenticated operations', async () => {
        const {connector} = fixture({
            onConnectionState: () => {
                throw new Error('UI rendering failed');
            },
        });

        await expect(connector.connect()).resolves.toBeUndefined();
        expect(connector.connectionState).toBe('ready');
    });
});

describe('FTP filename encoding', () => {
    it.each([
        'utf8',
        'utf-8',
        'latin1',
        'iso-8859-1',
        'ascii',
    ])('accepts explicitly supported %s', charset => {
        expect(() => resolveFilenameEncoding({charset})).not.toThrow();
    });

    it('rejects unsupported Windows-1252 and lossy names before sending commands', async () => {
        expect(() => fixture({filenameEncoding: {charset: 'windows-1252'}})).toThrow(NotSupportedError);

        const {connector, client} = fixture({filenameEncoding: {charset: 'latin1'}});

        await expect(connector.deleteFile('price-€.txt', {})).rejects.toBeInstanceOf(NotSupportedError);
        await expect(connector.moveFile('café.txt', 'price-€.txt', {})).rejects.toBeInstanceOf(NotSupportedError);
        expect(client.connect).not.toHaveBeenCalled();
        expect(() => validateFilename('\uD800.txt', 'utf8')).toThrow(NotSupportedError);
        expect(() => validateFilename('ambiguous-\uFFFD.txt', 'utf8')).toThrow(NotSupportedError);
    });

    it('negotiates explicit legacy mode and rejects a server that refuses it', async () => {
        const {connector, client} = fixture({filenameEncoding: {charset: 'latin1'}});

        await connector.connect();
        expect(client.ftp.encoding).toBe('latin1');
        expect(client.send).toHaveBeenCalledWith('OPTS UTF8 OFF');
        await connector.disconnect();
        client.send.mockRejectedValue(new FTPError({code: 500, message: 'Unsupported'}));
        await expect(connector.connect()).rejects.toBeInstanceOf(NotSupportedError);
    });

    it('keeps non-ASCII names exact and leaves file payload bytes untouched', async () => {
        const {connector, client} = fixture({filenameEncoding: {charset: 'latin1'}});
        const bytes = Buffer.from([
            0,
            128,
            255,
            195,
            169,
        ]);

        client.uploadFrom = vi.fn(async (stream: Readable, path: string) => {
            expect(path).toBe('café.bin');
            expect(await drain(stream)).toEqual(bytes);
        });
        client.list.mockResolvedValue([{name: 'café.bin', isFile: true, size: bytes.length}]);
        client.rename = vi.fn(async () => {});
        client.remove = vi.fn(async () => {});
        await connector.write('café.bin', Readable.from([bytes]), {});

        const entries = [];

        for await (const entry of connector.list('', {deep: false})) {
            entries.push(entry.path);
        }

        expect(entries).toEqual(['café.bin']);
        await connector.moveFile('café.bin', 'déjà.bin', {});
        await connector.deleteFile('déjà.bin', {});
        expect(client.rename).toHaveBeenCalledWith('café.bin', 'déjà.bin');
        expect(client.remove).toHaveBeenCalledWith('déjà.bin');
    });

    it('preserves high bits for ASCII validation instead of silently selecting a different name', async () => {
        const {connector, client} = fixture({filenameEncoding: {charset: 'ascii'}});

        client.list.mockResolvedValue([{name: 'café.txt', isFile: true}]);
        expect(client.ftp.encoding).toBe('latin1');
        await expect((async () => {
            for await (const _entry of connector.list('', {deep: false})) { /* drain */ }
        })()).rejects.toBeInstanceOf(NotSupportedError);
    });
});

describe('FTP transfer observation', () => {
    it('reports monotonic bytes per replayed attempt and completion only after protocol success', async () => {
        const {connector, client} = fixture({autoReconnect: true, maxTransientRetries: 1});
        const events: any[] = [];
        let calls = 0;

        client.uploadFrom = vi.fn(async (stream: Readable) => {
            expect((await drain(stream)).toString()).toBe('onetwo');
            calls++;

            if (calls === 1) {
                throw Object.assign(new Error('Synthetic reset'), {code: 'ECONNRESET'});
            }
        });
        await connector.write('bytes.txt', () => Readable.from(['one', 'two']), {
            totalBytes: 6,
            progressIntervalMs: 0,
            onProgress: event => events.push(event),
        });

        expect(events.some(event => event.attempt === 1 && event.bytesTransferred === 6)).toBe(true);
        expect(events.some(event => event.attempt === 2 && event.bytesTransferred === 6)).toBe(true);
        expect(events.filter(event => event.stage === 'completed')).toMatchObject([{attempt: 2}]);

        for (const attempt of [1, 2]) {
            const counts = events.filter(event => event.attempt === attempt).map(event => event.bytesTransferred);

            expect(counts).toEqual([...counts].sort((left, right) => left - right));
        }
    });

    it('propagates final FTP download failure after body bytes are received', async () => {
        const {connector, client} = fixture();
        const events: any[] = [];

        client.downloadTo = async (destination: Writable) => {
            destination.end(Buffer.from('bytes'));
            await tick();

            throw new Error('Final FTP completion rejected');
        };

        const stream = await connector.read('bytes.txt', {onProgress: event => events.push(event)});

        await expect(drain(stream)).rejects.toThrow('Final FTP completion rejected');
        expect(events.some(event => event.bytesTransferred === 5)).toBe(true);
        expect(events.some(event => event.stage === 'completed')).toBe(false);
    });
});

describe('FTP advanced transfer safety boundaries', () => {
    it('rejects no-clobber and atomic publication before starting network work', async () => {
        const {connector, client} = fixture();
        const source = vi.fn(() => Readable.from(['bytes']));

        await expect(connector.publishFile('file.txt', source)).rejects.toBeInstanceOf(NotSupportedError);
        await expect(connector.publishFile('file.txt', source, {
            overwrite: 'replace',
            requireAtomicRename: true,
        })).rejects.toBeInstanceOf(NotSupportedError);
        await expect(connector.copyFileWithStrategy('a', 'b')).rejects.toBeInstanceOf(NotSupportedError);
        expect(client.connect).not.toHaveBeenCalled();
        expect(source).not.toHaveBeenCalled();
    });

    it('uses exclusive MKD and non-recursive RMD without touching existing directories', async () => {
        const {connector, client} = fixture();

        await connector.createDirectoryExclusive('owned-temp');
        await connector.removeEmptyDirectory('owned-temp');
        expect(client.send.mock.calls.map((call: string[]) => call[0])).toEqual(['MKD owned-temp', 'RMD owned-temp']);
        client.send.mockRejectedValueOnce(new FTPError({code: 550, message: 'Directory already exists'}));
        await expect(connector.createDirectoryExclusive('existing')).rejects.toThrow();
        expect(client.send).toHaveBeenLastCalledWith('MKD existing');
        await expect(connector.createDirectoryExclusive('bad\r\nDELE other')).rejects.toBeInstanceOf(NotSupportedError);
    });

    it('runs only explicitly supported server hashes in one connection', async () => {
        const {connector, client} = fixture();
        const digest = 'a'.repeat(64);

        client.features = vi.fn(async () => new Map([['HASH', 'SHA-256*;SHA-512;']]));
        client.send = vi.fn(async (command: string) => command.startsWith('HASH ') ?
            {code: 213, message: `213 SHA-256 0-5 ${digest} file.txt`} : {code: 200, message: '200 Accepted'});
        await expect(connector.serverChecksum('file.txt', 'sha256')).resolves.toBe(digest);
        expect(client.send.mock.calls.map((call: string[]) => call[0])).toEqual(['OPTS HASH SHA-256', 'HASH file.txt']);
        client.features.mockResolvedValue(new Map());
        client.send.mockClear();
        await expect(connector.serverChecksum('file.txt', 'sha256')).rejects.toBeInstanceOf(NotSupportedError);
        expect(client.send).not.toHaveBeenCalled();
    });

    it('rejects malformed, mismatched and partial hash replies', async () => {
        const {connector, client} = fixture();

        client.features = vi.fn(async () => new Map([['HASH', 'SHA-256*;']]));

        for (const message of [
            '213 not-a-digest',
            `213 SHA-512 0-5 ${'a'.repeat(64)} file.txt`,
            `213 SHA-256 1-5 ${'a'.repeat(64)} file.txt`,
            `213 ${'a'.repeat(62)}`,
        ]) {
            client.send = vi.fn(async (command: string) => command.startsWith('HASH ') ?
                {code: 213, message} : {code: 200, message: '200 Accepted'});
            await expect(connector.serverChecksum('file.txt', 'sha256')).rejects.toThrow('invalid or mismatched');
        }
    });

    it('reports adapter capabilities locally and server features only on explicit negotiation', async () => {
        const {connector, client} = fixture();

        client.features = vi.fn(async () => new Map([['HASH', 'SHA-256*;'], ['MLST', 'type;size;']]));

        const adapter = await connector.capabilities();

        expect(adapter.negotiated).toBe(false);
        expect(adapter.server.checksum.state).toBe('unknown');
        expect(client.connect).not.toHaveBeenCalled();

        const negotiated = await connector.capabilities({negotiate: true});

        expect(negotiated.negotiated).toBe(true);
        expect(negotiated.server.checksum.algorithms).toEqual(['sha256']);
        expect(negotiated.server.pathPermissions.state).toBe('unknown');
        expect(client.features).toHaveBeenCalledOnce();
    });

    it('waits for throttled download output before reporting completed', async () => {
        const {connector, client} = fixture();
        const events: any[] = [];

        client.downloadTo = vi.fn(async (destination: Writable) => {
            destination.end(Buffer.from('payload'));
        });

        const stream = await connector.read('file.txt', {
            bandwidth: 1000,
            onProgress: event => events.push(event),
        });

        expect((await drain(stream)).toString()).toBe('payload');
        await tick();
        expect(events.filter(event => event.stage === 'completed')).toMatchObject([{bytesTransferred: 7}]);
    });
});

describe('FTP cancellation observations', () => {
    it('reports a cancelled download without a successful completion', async () => {
        const controller = new AbortController();
        const events: any[] = [];
        const {connector, client} = fixture();

        client.downloadTo = vi.fn(() => new Promise(() => {}));

        const stream = await connector.read('file.txt', {
            abortSignal: controller.signal,
            onProgress: event => events.push(event),
        });
        const consumed = drain(stream);
        const rejected = expect(consumed).rejects.toBeInstanceOf(OperationAbortedError);

        controller.abort();
        await rejected;
        await tick();
        expect(events.filter(event => event.stage === 'cancelled')).toHaveLength(1);
        expect(events.some(event => event.stage === 'completed')).toBe(false);
    });

    it('emits one failed keepalive outcome for a closed session and no background reconnect', async () => {
        vi.useFakeTimers();

        const states: string[] = [];
        const {connector, client} = fixture({
            autoReconnect: true,
            keepalive: {intervalMs: 1000, maxMissed: 2},
            onConnectionState: event => states.push(event.state),
        });

        await connector.connect();
        client.send.mockImplementation(async () => {
            client.close();

            throw Object.assign(new Error('Disconnected probe'), {code: 'ECONNRESET'});
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(states.filter(state => state === 'failed')).toHaveLength(1);
        expect(client.connect).toHaveBeenCalledOnce();
    });
});
