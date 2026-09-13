import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {PassThrough, Readable, Writable} from 'node:stream';
import {once} from 'node:events';
import {
    AuthError, ConnectorError, ConnectionClosedError, HostTrustError, NotFoundError,
    OperationAbortedError, OperationTimeoutError, PermissionError,
} from '@dockline/abstract';
import {SftpConnector, type SftpConnectorConfig} from '../src/SftpConnector.js';

const state = vi.hoisted(() => ({
    clients: [] as any[],
    configure: (_client: any) => {},
}));

vi.mock('ssh2-sftp-client', () => ({
    default: class {
        callbacks: any;

        client = {destroy: vi.fn()};

        connect = vi.fn(async (_options: any) => {});

        end = vi.fn(async () => true);

        lstat = vi.fn(async () => ({
            isFile: true,
            isDirectory: false,
            isSymbolicLink: false,
            size: 12,
            modifyTime: 0,
        }));

        list = vi.fn(async () => []);

        createReadStream = vi.fn();

        createWriteStream = vi.fn();

        delete = vi.fn(async () => {});

        mkdir = vi.fn(async () => {});

        rmdir = vi.fn(async () => {});

        rename = vi.fn(async () => {});

        rcopy = vi.fn(async () => {});

        constructor(_name: string, callbacks: any) {
            this.callbacks = callbacks;
            state.clients.push(this);
            state.configure(this);
        }
    },
}));

const config: SftpConnectorConfig = {
    host: 'fixture.invalid',
    port: 22,
    username: 'fixture',
    initialPath: '',
    timeoutMs: 1000,
};
const instances: SftpConnector[] = [];
const connector = (options: Partial<SftpConnectorConfig> = {}) => {
    const result = new SftpConnector({...config, ...options});

    instances.push(result);

    return result;
};
const transient = () => Object.assign(new Error('Connection reset'), {code: 'ECONNRESET'});
const consume = async (stream: unknown) => {
    const chunks: Buffer[] = [];

    for await (const chunk of stream as Readable) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
};
const hostKey = (suffix: string) => {
    const algorithm = Buffer.from('ssh-ed25519');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(algorithm.length);

    return Buffer.concat([length, algorithm, Buffer.from(suffix)]);
};

beforeEach(() => {
    state.clients = [];
    state.configure = () => {};
});

afterEach(async () => {
    await Promise.all(instances.splice(0).map((instance) => instance.disconnect()));
});

describe('SFTP lifecycle and retries', () => {
    it('coalesces simultaneous first connections', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        state.configure = (client) => {
            client.connect.mockImplementation(() => gate);
        };

        const adapter = connector();
        const first = adapter.connect();
        const second = adapter.connect();

        await vi.waitFor(() => expect(state.clients[0].connect).toHaveBeenCalledTimes(1));
        release();
        await Promise.all([first, second]);
        expect(state.clients).toHaveLength(1);
    });

    it('retries an initial transient connection up to three additional times by default', async () => {
        state.configure = (client) => {
            if (state.clients.length < 4) {
                client.connect.mockRejectedValue(transient());
            }
        };

        await connector().connect();
        expect(state.clients).toHaveLength(4);
        expect(state.clients.every((client) => client.connect.mock.calls.length === 1)).toBe(true);
    });

    it('lets a second connection waiter cancel or time out without cancelling the first', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        state.configure = (client) => {
            client.connect.mockImplementation(() => gate);
        };

        const adapter = connector();
        const first = adapter.connect();
        const controller = new AbortController();
        const waiting = adapter.connect({abortSignal: controller.signal});
        const rejected = expect(waiting).rejects.toBeInstanceOf(OperationAbortedError);

        controller.abort();
        await rejected;
        await expect(adapter.connect({timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(state.clients[0].client.destroy).not.toHaveBeenCalled();
        expect(state.clients[0].connect).toHaveBeenCalledTimes(1);
        release();
        await first;
    });

    it('does not retry authentication errors', async () => {
        state.configure = (client) => {
            client.connect.mockRejectedValue(new Error('All configured authentication methods failed'));
        };

        await expect(connector({autoReconnect: true}).connect()).rejects.toBeInstanceOf(AuthError);
        expect(state.clients).toHaveLength(1);
    });

    it('recognizes the dependency generic-code wrapper around handshake timeouts', async () => {
        state.configure = (client) => {
            if (state.clients.length === 1) {
                client.connect.mockRejectedValue(Object.assign(new Error('getConnection: Timed out while waiting for handshake'), {code: 'ERR_GENERIC_CLIENT'}));
            }
        };

        await connector().connect();
        expect(state.clients).toHaveLength(2);
    });

    it('uses the actual modifyTime field and accepts the Unix epoch', async () => {
        expect(await connector().lastModified('file.txt')).toBe(0);
    });

    it('does not reconnect implicitly after a lost established session by default', async () => {
        const adapter = connector();

        await adapter.connect();
        state.clients[0].callbacks.close();
        await expect(adapter.stat('file.txt')).rejects.toBeInstanceOf(ConnectionClosedError);
        expect(state.clients).toHaveLength(1);
        await adapter.connect();
        expect(state.clients).toHaveLength(2);
    });

    it('honors per-call reconnect and retry overrides for safe metadata calls', async () => {
        state.configure = (client) => {
            if (state.clients.length === 1) {
                client.lstat.mockRejectedValue(transient());
            }
        };

        const adapter = connector({autoReconnect: false, maxTransientRetries: 0});

        expect((await adapter.stat('file.txt', {autoReconnect: true, maxTransientRetries: 1})).type).toBe('file');
        expect(state.clients).toHaveLength(2);
    });

    it('does not retry permission failures or turn them into absence', async () => {
        state.configure = (client) => {
            client.lstat.mockRejectedValue(Object.assign(new Error('Denied'), {code: 3}));
        };

        await expect(connector({autoReconnect: true}).fileExists('file.txt')).rejects.toBeInstanceOf(PermissionError);
        expect(state.clients).toHaveLength(1);
    });

    it('checks an already aborted signal before connecting or consuming an upload', async () => {
        const source = vi.fn(() => Readable.from(['data']));

        await expect(connector().write('file.txt', source, {abortSignal: AbortSignal.abort()})).rejects.toBeInstanceOf(OperationAbortedError);
        expect(source).not.toHaveBeenCalled();
        expect(state.clients[0].connect).not.toHaveBeenCalled();
    });

    it('times out a hung metadata attempt and retries with a fresh client when enabled', async () => {
        state.configure = (client) => {
            if (state.clients.length === 1) {
                client.lstat.mockImplementation(() => new Promise(() => {}));
            }
        };

        expect((await connector({autoReconnect: true, timeoutMs: 20, maxTransientRetries: 1}).stat('file.txt')).type).toBe('file');
        expect(state.clients).toHaveLength(2);
        expect(state.clients[0].client.destroy).toHaveBeenCalled();
    });

    it('shares one retry budget between connection and operation failures', async () => {
        state.configure = (client) => {
            if (state.clients.length === 2) {
                client.lstat.mockImplementation(() => new Promise(() => {}));
            } else {
                client.connect.mockRejectedValue(transient());
            }
        };

        await expect(connector({autoReconnect: true, timeoutMs: 20, maxTransientRetries: 2}).stat('file.txt')).rejects.toBeInstanceOf(ConnectorError);
        expect(state.clients).toHaveLength(3);
        expect(state.clients[1].lstat).toHaveBeenCalledTimes(1);
    });

    it('shares one per-attempt deadline between a slow connection and a slow operation', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});

        try {
            state.configure = (client) => {
                client.connect.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 60)));
                client.lstat.mockImplementation(() =>
                    new Promise((resolve) => setTimeout(() => resolve({isFile: true, modifyTime: 0}), 60)),
                );
            };

            const pending = connector({timeoutMs: 100, maxTransientRetries: 0}).stat('file.txt');
            const rejected = expect(pending).rejects.toBeInstanceOf(OperationTimeoutError);

            await vi.advanceTimersByTimeAsync(100);
            await rejected;
            expect(state.clients[0].connect).toHaveBeenCalledTimes(1);
            expect(state.clients[0].lstat).toHaveBeenCalledTimes(1);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('does not invalidate another connection owner when an operation waiter times out', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        state.configure = (client) => {
            client.connect.mockImplementation(() => gate);
        };

        const adapter = connector();
        const first = adapter.connect({timeoutMs: 1000, maxTransientRetries: 0});

        await expect(adapter.stat('file.txt', {timeoutMs: 20, maxTransientRetries: 0})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(state.clients[0].client.destroy).not.toHaveBeenCalled();
        release();
        await first;
    });

    it('does not let a failed old concurrent operation destroy a replacement session', async () => {
        let failFirst!: (error: Error) => void;

        state.configure = (client) => {
            if (state.clients.length === 1) {
                client.lstat.mockImplementation((path: string) => path === 'first' ?
                    new Promise((_resolve, reject) => {
                        failFirst = reject;
                    }) :
                    new Promise(() => {}));
            }
        };

        const adapter = connector();

        await adapter.connect();

        const first = adapter.stat('first', {autoReconnect: true, maxTransientRetries: 1});
        const second = adapter.stat('second', {autoReconnect: false, maxTransientRetries: 0});
        const secondRejected = expect(second).rejects.toBeInstanceOf(ConnectorError);

        await vi.waitFor(() => expect(state.clients[0].lstat).toHaveBeenCalledTimes(2));
        failFirst(transient());
        await expect(first).resolves.toMatchObject({type: 'file'});
        await secondRejected;
        expect(state.clients).toHaveLength(2);
        expect(state.clients[1].client.destroy).not.toHaveBeenCalled();
    });

    it('does not reconnect a cancelled operation after explicit disconnect', async () => {
        state.configure = (client) => {
            client.lstat.mockImplementation(() => new Promise(() => {}));
        };

        const adapter = connector({autoReconnect: true});
        const pending = adapter.stat('file.txt');
        const rejected = expect(pending).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(state.clients[0].lstat).toHaveBeenCalled());
        await adapter.disconnect();
        await rejected;
        expect(state.clients).toHaveLength(1);
    });

    it('never replays a mutation after a transient failure', async () => {
        state.configure = (client) => {
            client.delete.mockRejectedValue(transient());
        };

        await expect(connector({autoReconnect: true}).deleteFile('file.txt')).rejects.toBeInstanceOf(ConnectorError);
        expect(state.clients[0].delete).toHaveBeenCalledTimes(1);
        expect(state.clients).toHaveLength(1);
    });
});

describe('SFTP owned streams', () => {
    it('delivers a remote missing-file failure as the shared NotFoundError', async () => {
        const source = new PassThrough();

        state.configure = (client) => {
            client.createReadStream.mockReturnValue(source);
        };

        const stream = await connector().read('missing.txt');
        const reading = consume(stream);

        source.destroy(Object.assign(new Error('No such file'), {code: 2}));
        await expect(reading).rejects.toBeInstanceOf(NotFoundError);
    });

    it('destroys the remote source when the consumer closes early', async () => {
        const source = new PassThrough();

        state.configure = (client) => {
            client.createReadStream.mockReturnValue(source);
        };

        const stream = await connector().read('large.bin') as Readable;

        stream.destroy();
        await once(stream, 'close');
        expect(source.destroyed).toBe(true);
    });

    it('bounds a stalled download and releases its remote stream', async () => {
        const source = new PassThrough();

        state.configure = (client) => {
            client.createReadStream.mockReturnValue(source);
        };

        await expect(consume(await connector().read('hung.bin', {timeoutMs: 20}))).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(source.destroyed).toBe(true);
    });

    it('preserves the same attempt deadline through connection and returned read stream', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});

        try {
            const source = new PassThrough();

            state.configure = (client) => {
                client.connect.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 60)));
                client.createReadStream.mockImplementation(() => {
                    setTimeout(() => source.end('too late'), 60);

                    return source;
                });
            };

            const pending = connector({timeoutMs: 100, maxTransientRetries: 0}).read('file.txt');

            await vi.advanceTimersByTimeAsync(60);

            const reading = consume(await pending);
            const rejected = expect(reading).rejects.toBeInstanceOf(OperationTimeoutError);

            await vi.advanceTimersByTimeAsync(40);
            await rejected;
            expect(source.destroyed).toBe(true);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('aborts in-flight downloads with a typed error and remote cleanup', async () => {
        const source = new PassThrough();

        state.configure = (client) => {
            client.createReadStream.mockReturnValue(source);
        };

        const controller = new AbortController();
        const reading = consume(await connector().read('large.bin', {abortSignal: controller.signal}));

        controller.abort();
        await expect(reading).rejects.toBeInstanceOf(OperationAbortedError);
        expect(source.destroyed).toBe(true);
    });

    it('reopens an explicitly repeatable upload with a fresh source after transient failure', async () => {
        const completed: Buffer[] = [];
        const sources: Readable[] = [];

        state.configure = (client) => {
            const first = state.clients.length === 1;

            client.createWriteStream.mockImplementation(() => new Writable({
                write(chunk, _encoding, callback) {
                    if (first) {
                        callback(transient());
                    } else {
                        completed.push(Buffer.from(chunk));
                        callback();
                    }
                },
            }));
        };

        await connector({autoReconnect: true}).write('file.txt', () => {
            const source = Readable.from(['complete upload']);

            sources.push(source);

            return source;
        });
        expect(Buffer.concat(completed).toString()).toBe('complete upload');
        expect(state.clients).toHaveLength(2);
        expect(sources).toHaveLength(2);
        expect(sources[0].destroyed).toBe(true);
    });

    it('never replays a one-shot upload or a permission-denied upload', async () => {
        state.configure = (client) => {
            client.createWriteStream.mockImplementation(() => new Writable({
                write(_chunk, _encoding, callback) {
                    callback(transient());
                },
            }));
        };

        await expect(connector({autoReconnect: true}).write('file.txt', Readable.from(['data']))).rejects.toBeInstanceOf(ConnectorError);
        expect(state.clients).toHaveLength(1);
        state.configure = (client) => {
            client.createWriteStream.mockImplementation(() => new Writable({
                write(_chunk, _encoding, callback) {
                    callback(Object.assign(new Error('Denied'), {code: 3}));
                },
            }));
        };

        const freshSource = vi.fn(() => Readable.from(['data']));

        await expect(connector({autoReconnect: true}).write('file.txt', freshSource)).rejects.toBeInstanceOf(PermissionError);
        expect(freshSource).toHaveBeenCalledTimes(1);
    });

    it('rejects an upload source factory that reuses a consumed stream', async () => {
        state.configure = (client) => {
            client.createWriteStream.mockImplementation(() => new Writable({
                write(_chunk, _encoding, callback) {
                    callback(transient());
                },
            }));
        };

        const reused = Readable.from(['data']);

        await expect(connector({autoReconnect: true}).write('file.txt', () => reused)).rejects.toThrow('fresh readable stream');
        expect(state.clients[1].createWriteStream).not.toHaveBeenCalled();
    });

    it('rejects a drained but undestroyed factory stream before truncating the remote target', async () => {
        const source = new Readable({
            autoDestroy: false,
            read() {
                this.push('data');
                this.push(null);
            },
        });

        await consume(source);
        expect(source.destroyed).toBe(false);
        expect(source.readableEnded).toBe(true);
        await expect(connector({autoReconnect: true}).write('file.txt', () => source)).rejects.toThrow('fresh readable stream');
        expect(state.clients[0].createWriteStream).not.toHaveBeenCalled();
    });

    it('aborts an in-flight upload without asking its source factory for another stream', async () => {
        const source = new PassThrough();
        const destination = new PassThrough();

        state.configure = (client) => {
            client.createWriteStream.mockReturnValue(destination);
        };

        const controller = new AbortController();
        const factory = vi.fn(() => source);
        const writing = connector({autoReconnect: true}).write('file.txt', factory, {abortSignal: controller.signal});
        const rejected = expect(writing).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(state.clients[0].createWriteStream).toHaveBeenCalled());
        controller.abort();
        await rejected;
        expect(source.destroyed).toBe(true);
        expect(destination.destroyed).toBe(true);
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('keeps late source-factory completion isolated from the next upload attempt', async () => {
        let release!: (source: Readable) => void;
        const lateSource = new PassThrough();
        const currentSource = new PassThrough();
        const first = new Promise<Readable>((resolve) => {
            release = resolve;
        });
        let calls = 0;

        state.configure = (client) => {
            client.createWriteStream.mockImplementation(() => new PassThrough());
        };

        const controller = new AbortController();
        const writing = connector({autoReconnect: true, timeoutMs: 80, maxTransientRetries: 1})
            .write('file.txt', () => ++calls === 1 ? first : currentSource, {abortSignal: controller.signal});
        const rejected = expect(writing).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(calls).toBe(2), {interval: 2});
        release(lateSource);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(lateSource.destroyed).toBe(true);
        expect(currentSource.destroyed).toBe(false);
        controller.abort();
        await rejected;
        expect(currentSource.destroyed).toBe(true);
    });

    it('destroys a late source-factory result even when no retry is allowed', async () => {
        let release!: (source: Readable) => void;
        const lateSource = new PassThrough();
        const pending = new Promise<Readable>((resolve) => {
            release = resolve;
        });

        await expect(connector({timeoutMs: 20}).write('file.txt', () => pending)).rejects.toBeInstanceOf(OperationTimeoutError);
        release(lateSource);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(lateSource.destroyed).toBe(true);
        expect(state.clients[0].createWriteStream).not.toHaveBeenCalled();
    });
});

describe('SFTP trust policy', () => {
    it('requires both hooks before any network connection in strict policy mode', async () => {
        await expect(
            connector({requireTrustPolicy: true, hasTrustPolicy: () => true}).connect(),
        ).rejects.toBeInstanceOf(HostTrustError);
        expect(state.clients[0].connect).not.toHaveBeenCalled();
    });

    it('checks remembered keys first and never prompts for an unchanged trusted key', async () => {
        const order: string[] = [];

        state.configure = (client) => {
            client.connect.mockImplementation(async (options: any) => {
                const accepted = await new Promise((resolve) => options.hostVerifier(hostKey('one'), resolve));

                if (!accepted) {
                    throw new Error('Host key verification failed');
                }
            });
        };

        const adapter = connector({
            requireTrustPolicy: true,
            hasTrustPolicy: async (challenge) => {
                order.push('lookup');
                expect(challenge.fingerprint).toMatch(/^SHA256:/);
                expect(challenge.keyType).toBe('ssh-ed25519');
                expect(challenge.publicKey).toEqual(hostKey('one'));

                return true;
            },
            acceptTrustPolicy: async () => {
                order.push('prompt');

                return true;
            },
        });

        await adapter.connect();
        expect(order).toEqual(['lookup']);
    });

    it('asks explicitly for a changed key even if the lookup hook returns true', async () => {
        const challenges: any[] = [];

        state.configure = (client) => {
            const key = hostKey(String(state.clients.length));

            client.connect.mockImplementation(async (options: any) => {
                if (!await new Promise((resolve) => options.hostVerifier(key, resolve))) {
                    throw new Error('Host key verification failed');
                }
            });
        };

        const adapter = connector({
            requireTrustPolicy: true,
            hasTrustPolicy: async () => true,
            acceptTrustPolicy: async (challenge) => {
                challenges.push(challenge);

                return false;
            },
        });

        await adapter.connect();
        await adapter.disconnect();
        await expect(adapter.connect()).rejects.toBeInstanceOf(HostTrustError);
        expect(challenges).toHaveLength(1);
        expect(challenges[0].changed).toBe(true);
        expect(challenges[0].previousFingerprint).toMatch(/^SHA256:/);
    });

    it('supports callback verifiers and enforces them before trust hooks', async () => {
        state.configure = (client) => {
            client.connect.mockImplementation(async (options: any) => {
                if (!await new Promise((resolve) => options.hostVerifier(hostKey('one'), resolve))) {
                    throw new Error('Host key verification failed');
                }
            });
        };

        const lookup = vi.fn(async () => true);

        await expect(connector({
            requireTrustPolicy: true,
            hostVerifier: (_key: Buffer, accept: (accepted: boolean) => void) => {
                queueMicrotask(() => accept(false));
            },
            hasTrustPolicy: lookup,
            acceptTrustPolicy: () => true,
        }).connect()).rejects.toBeInstanceOf(HostTrustError);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('cancels a pending trust lookup without opening a late approval prompt', async () => {
        let release!: (value: boolean) => void;
        const lookup = new Promise<boolean>((resolve) => {
            release = resolve;
        });
        const prompt = vi.fn(() => true);

        state.configure = (client) => {
            client.connect.mockImplementation(async (options: any) => {
                if (!await new Promise((resolve) => options.hostVerifier(hostKey('one'), resolve))) {
                    throw new Error('Host key verification failed');
                }
            });
        };

        const adapter = connector({requireTrustPolicy: true, hasTrustPolicy: () => lookup, acceptTrustPolicy: prompt});

        await expect(
            adapter.connect({timeoutMs: 20, maxTransientRetries: 0}),
        ).rejects.toBeInstanceOf(OperationTimeoutError);
        release(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(prompt).not.toHaveBeenCalled();
        expect(state.clients[0].client.destroy).toHaveBeenCalled();
    });
});
