import {describe, expect, it, vi} from 'vitest';
import {PassThrough, Readable} from 'node:stream';
import {ConnectorPool} from '../src/ConnectorPool.js';
import {OperationAbortedError, OperationTimeoutError, PoolClosedError} from '../src/errors.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function connection() {
    return {
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        stat: vi.fn(async () => ({type: 'file', size: 1})),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });

    return {promise, resolve, reject};
}

describe('pool retirement and shutdown deadlines', () => {
    it('force-closes an explicitly held empty lease, revokes its proxy and retires exactly once', async () => {
        const remote = connection();
        const pool = new ConnectorPool({create: () => remote, maxConnections: 1});
        const lease = await pool.acquire();
        const firstClose = pool.close({force: true, timeoutMs: 100});
        const secondClose = pool.close({force: true, timeoutMs: 100});

        expect(() => lease.connector.connect()).toThrow(PoolClosedError);
        expect(() => lease.connector.stat()).toThrow(PoolClosedError);
        await Promise.all([firstClose, secondClose]);
        await Promise.all([lease.release(), lease.release()]);
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(remote.connect).toHaveBeenCalledOnce();
        expect(pool.stats).toMatchObject({connections: 0, active: 0});
    });

    it('applies close timeout to an idle connector whose disconnect hangs', async () => {
        const closing = deferred<void>();
        const remote = {...connection(), disconnect: vi.fn(() => closing.promise)};
        const pool = new ConnectorPool({create: () => remote, idleTimeoutMs: 0});
        const lease = await pool.acquire();

        await lease.release();
        await expect(pool.close({timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(1);
        closing.resolve();
        await tick();
        await pool.close();
        expect(pool.stats.connections).toBe(0);
    });

    it('retains the physical connection count while a forced disconnect is pending', async () => {
        const closing = deferred<void>();
        const remote = {...connection(), disconnect: vi.fn(() => closing.promise)};
        const pool = new ConnectorPool({create: () => remote, maxConnections: 1});
        const lease = await pool.acquire();

        await expect(pool.close({force: true, timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(pool.stats).toMatchObject({connections: 1, active: 0});
        await expect(pool.acquire()).rejects.toBeInstanceOf(PoolClosedError);
        expect(() => lease.connector.connect()).toThrow(PoolClosedError);
        closing.resolve();
        await lease.release();
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(0);
    });

    it('allows active work to finish during a graceful close before releasing the connection', async () => {
        const remote = connection();
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();
        const closing = pool.close({timeoutMs: 100});

        await expect(lease.connector.stat()).resolves.toMatchObject({type: 'file'});
        expect(remote.disconnect).not.toHaveBeenCalled();
        await lease.release();
        await closing;
        expect(remote.disconnect).toHaveBeenCalledOnce();
    });

    it('times out a graceful close and then revokes the still-held lease', async () => {
        const remote = connection();
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();

        await expect(pool.close({timeoutMs: 20})).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(() => lease.connector.stat()).toThrow(PoolClosedError);
        await lease.release();
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(0);
    });
});

describe('pool late factory and method results', () => {
    it('keeps a cancelled creation and its disconnect inside the connection limit', async () => {
        const creating = deferred<ReturnType<typeof connection>>();
        const closing = deferred<void>();
        const abandoned = {...connection(), disconnect: vi.fn(() => closing.promise)};
        const nextRemote = connection();
        const create = vi.fn().mockImplementationOnce(() => creating.promise).mockReturnValue(nextRemote);
        const pool = new ConnectorPool({create, maxConnections: 1});
        const cancellation = new AbortController();
        const first = pool.acquire({abortSignal: cancellation.signal});
        const failed = expect(first).rejects.toBeInstanceOf(OperationAbortedError);

        cancellation.abort();
        await failed;

        const next = pool.acquire({timeoutMs: 500});

        await tick();
        expect(create).toHaveBeenCalledOnce();
        creating.resolve(abandoned);
        await tick();
        expect(abandoned.connect).not.toHaveBeenCalled();
        expect(abandoned.disconnect).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(1);
        closing.resolve();

        const lease = await next;

        expect(create).toHaveBeenCalledTimes(2);
        expect(pool.stats.connections).toBe(1);
        await lease.release();
        await pool.close();
    });

    it('rejects a pending read on force close and destroys the stream if it arrives later', async () => {
        const reading = deferred<Readable>();
        const remote = {...connection(), read: vi.fn(() => reading.promise)};
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();
        const pending = lease.connector.read();
        const failed = expect(pending).rejects.toBeInstanceOf(PoolClosedError);

        await pool.close({force: true});
        await failed;

        const late = new PassThrough();

        reading.resolve(late);
        await tick();
        expect(late.destroyed).toBe(true);
        await lease.release();
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(0);
    });

    it('rejects and cleans a synchronous stream returned while its method force-closes the pool', async () => {
        const stream = new PassThrough();
        let closing: Promise<void> | undefined;
        const remote = {
            ...connection(),
            read() {
                closing = pool.close({force: true});

                return stream;
            },
        };
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();

        expect(() => lease.connector.read()).toThrow(PoolClosedError);
        await closing;
        await tick();
        expect(stream.destroyed).toBe(true);
        await lease.release();
        expect(remote.disconnect).toHaveBeenCalledOnce();
    });

    it('cleans iterator values produced after their method was forcibly interrupted', async () => {
        const value = deferred<AsyncIterableIterator<number>>();
        const returned = vi.fn(async () => ({done: true as const, value: undefined}));
        const iterator = {
            [Symbol.asyncIterator]() {
                return this;
            },
            async next() {
                return {done: false, value: 1};
            },
            return: returned,
        };
        const remote = {...connection(), list: () => value.promise};
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();
        const pending = lease.connector.list();
        const failed = expect(pending).rejects.toBeInstanceOf(PoolClosedError);

        await pool.close({force: true});
        await failed;
        value.resolve(iterator);
        await tick();
        expect(returned).toHaveBeenCalledOnce();
        await lease.release();
    });
});

describe('pool iterator contracts', () => {
    it('disposes a connection after iterator return cleanup fails', async () => {
        const remotes: Array<ReturnType<typeof connection>> = [];
        const create = () => {
            const remote = {
                ...connection(),
                list() {
                    return {
                        [Symbol.asyncIterator]() {
                            return this;
                        },
                        async next() {
                            return {done: false, value: 1};
                        },
                        async return() {
                            throw new Error('Iterator cleanup failed');
                        },
                    };
                },
            };

            remotes.push(remote);

            return remote;
        };
        const pool = new ConnectorPool({create, maxConnections: 1});
        const first = await pool.acquire();
        const iterator = first.connector.list();

        await iterator.next();
        await expect(iterator.return()).rejects.toThrow('Iterator cleanup failed');
        await first.release();

        const second = await pool.acquire();

        expect(remotes).toHaveLength(2);
        expect(remotes[0].disconnect).toHaveBeenCalledOnce();
        await second.release();
        await pool.close();
    });

    it('forwards generator throw and retains the lease when the generator recovers', async () => {
        const remote = {
            ...connection(),
            async *list() {
                try {
                    yield 'first';
                } catch {
                    yield 'recovered';
                }
            },
        };
        const pool = new ConnectorPool({create: () => remote, maxConnections: 1});
        const iterator = await pool.withConnection(connector => connector.list());

        await expect(iterator.next()).resolves.toMatchObject({value: 'first', done: false});
        await expect(iterator.throw(new Error('Injected error'))).resolves.toMatchObject({value: 'recovered', done: false});
        expect(pool.stats.active).toBe(1);
        await expect(iterator.next()).resolves.toMatchObject({done: true});
        await tick();
        expect(pool.stats.active).toBe(0);
        await pool.close();
    });

    it('retains a generator that yields during return cleanup until that cleanup finishes', async () => {
        const remote = {
            ...connection(),
            async *list() {
                try {
                    yield 'first';
                } finally {
                    yield 'cleanup';
                }
            },
        };
        const pool = new ConnectorPool({create: () => remote, maxConnections: 1});
        const iterator = await pool.withConnection(connector => connector.list());

        await iterator.next();
        await expect(iterator.return(undefined)).resolves.toMatchObject({value: 'cleanup', done: false});
        expect(pool.stats.active).toBe(1);
        await iterator.next();
        await tick();
        expect(pool.stats.active).toBe(0);
        await pool.close();
    });

    it('interrupts an outstanding iterator next even if the underlying iterator ignores disconnect', async () => {
        const returned = vi.fn(async () => ({done: true as const, value: undefined}));
        const remote = {
            ...connection(),
            list() {
                return {
                    [Symbol.asyncIterator]() {
                        return this;
                    },
                    next: () => new Promise<IteratorResult<number>>(() => {}),
                    return: returned,
                };
            },
        };
        const pool = new ConnectorPool({create: () => remote});
        const iterator = await pool.withConnection(connector => connector.list());
        const pending = iterator.next();
        const failed = expect(pending).rejects.toBeInstanceOf(PoolClosedError);

        await pool.close({force: true});
        await failed;
        expect(returned).toHaveBeenCalledOnce();
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(0);
    });

    it('holds a returned walk object until its entries end', async () => {
        const remote = {
            ...connection(),
            walk() {
                return {
                    entries: (async function* () {
                        yield 'one';
                    })(),
                    result: Promise.resolve({complete: true}),
                };
            },
        };
        const pool = new ConnectorPool({create: () => remote, maxConnections: 1});
        const walk = await pool.withConnection(connector => connector.walk());

        expect(pool.stats.active).toBe(1);
        await walk.entries.next();
        expect(pool.stats.active).toBe(1);
        await walk.entries.next();
        await tick();
        expect(pool.stats.active).toBe(0);
        await pool.close();
    });
});

describe('pool arbitrary JavaScript rejections', () => {
    it('treats iterator cleanup rejection with undefined as failure and retires the connector', async () => {
        const remote = {
            ...connection(),
            list() {
                return {
                    [Symbol.asyncIterator]() {
                        return this;
                    },
                    async next() {
                        return {done: false, value: 1};
                    },
                    return: () => Promise.reject(undefined),
                };
            },
        };
        const pool = new ConnectorPool({create: () => remote});
        const lease = await pool.acquire();
        const iterator = lease.connector.list();

        await iterator.next();
        await expect(iterator.return()).rejects.toBeUndefined();
        await lease.release();
        expect(remote.disconnect).toHaveBeenCalledOnce();
        expect(pool.stats.connections).toBe(0);
        await pool.close();
    });
});
