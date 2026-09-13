import {Readable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {ConnectionClosedError, OperationAbortedError, OperationTimeoutError, PoolClosedError} from './errors.js';
import type {ConnectorOperationOptions} from './operation-options.js';

export interface PoolConnection {
    connect(options?: ConnectorOperationOptions): Promise<void>;
    disconnect(): Promise<void>;
}

export interface PoolOptions<T extends PoolConnection> {
    create: (context: {abortSignal: AbortSignal}) => T | Promise<T>;
    maxConnections?: number;
    /** Optional server connection ceiling; zero means no extra server limit. */
    serverMaxConnections?: number;
    idleTimeoutMs?: number;
}

interface Slot<T> {
    connector: T;
    idleTimer?: ReturnType<typeof setTimeout>;
    broken: boolean;
    retired: boolean;
    disposal?: Promise<void>;
    resources: Set<() => void>;
}

interface Waiter<T> {
    resolve: (lease: ConnectionLease<T>) => void;
    reject: (error: Error) => void;
    options: ConnectorOperationOptions;
    controller: AbortController;
    cancelled: boolean;
    timer?: ReturnType<typeof setTimeout>;
    abort: () => void;
    cleanup: () => void;
}

export interface ConnectionLease<T> {
    readonly connector: T;
    /** Waits for every tracked operation, returned stream and iterator before making the session available. */
    release(): Promise<void>;
}

/** Every leased operation counts equally, including directory listings and metadata requests. */
export class ConnectorPool<T extends PoolConnection> {
    public readonly maxConnections: number;

    private readonly idle: Slot<T>[] = [];

    private readonly active = new Set<Slot<T>>();

    private readonly waiters: Waiter<T>[] = [];

    private readonly creating = new Set<Waiter<T>>();

    private readonly closingListeners = new Set<() => void>();

    private total = 0;

    private closed = false;

    private readonly idleTimeoutMs: number;

    public constructor(private readonly options: PoolOptions<T>) {
        const configured = options.maxConnections ?? 3;
        const serverLimit = options.serverMaxConnections ?? 0;

        if (
            !Number.isSafeInteger(configured) ||
            configured < 1 ||
            !Number.isSafeInteger(serverLimit) ||
            serverLimit < 0
        ) {
            throw new RangeError('Connection limits must be positive integers (server zero means unlimited)');
        }

        this.maxConnections = serverLimit ? Math.min(configured, serverLimit) : configured;
        this.idleTimeoutMs = options.idleTimeoutMs ?? 30000;

        if (!Number.isSafeInteger(this.idleTimeoutMs) || this.idleTimeoutMs < 0 || this.idleTimeoutMs > 2147483647) {
            throw new RangeError('idleTimeoutMs must be an integer from 0 to 2147483647');
        }
    }

    public get stats(): Readonly<{
        limit: number;
        connections: number;
        active: number;
        queued: number;
    }> {
        return Object.freeze({
            limit: this.maxConnections,
            connections: this.total,
            active: this.active.size + this.creating.size,
            queued: this.waiters.length,
        });
    }

    public acquire(options: ConnectorOperationOptions = {}): Promise<ConnectionLease<T>> {
        if (this.closed) {
            return Promise.reject(new PoolClosedError('The connection pool is closed'));
        }

        if (options.abortSignal?.aborted) {
            return Promise.reject(new OperationAbortedError());
        }

        const timeout = options.timeoutMs ?? options.timeout ?? 30000;

        if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483647) {
            return Promise.reject(new RangeError('Acquisition timeout must be an integer from 0 to 2147483647'));
        }

        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const cancel = (error: Error) => {
                if (waiter.cancelled) {
                    return;
                }

                waiter.cancelled = true;
                controller.abort();
                waiter.cleanup();

                const index = this.waiters.indexOf(waiter);

                if (index >= 0) {
                    this.waiters.splice(index, 1);
                }

                reject(error);
                this.pump();
            };
            const waiter: Waiter<T> = {
                resolve,
                reject,
                options,
                controller,
                cancelled: false,
                abort: () => cancel(new OperationAbortedError()),
                cleanup: () => {
                    clearTimeout(waiter.timer);
                    options.abortSignal?.removeEventListener('abort', waiter.abort);
                },
            };

            if (timeout) {
                waiter.timer = setTimeout(() => cancel(new OperationTimeoutError('Connection pool acquisition timed out')), timeout);
            }

            options.abortSignal?.addEventListener('abort', waiter.abort, {once: true});
            this.waiters.push(waiter);
            this.pump();
        });
    }

    private pump(): void {
        while (!this.closed && this.waiters.length && (this.idle.length || this.total < this.maxConnections)) {
            const waiter = this.waiters.shift()!;
            const reusable = this.idle.shift();

            if (reusable) {
                clearTimeout(reusable.idleTimer);
            } else {
                this.total++;
            }

            this.creating.add(waiter);
            void this.prepare(waiter, reusable);
        }
    }

    private async prepare(waiter: Waiter<T>, reusable?: Slot<T>): Promise<void> {
        let slot = reusable;

        try {
            slot ??= {
                connector: await this.options.create({abortSignal: waiter.controller.signal}),
                broken: false,
                retired: false,
                resources: new Set(),
            };

            if (waiter.cancelled || this.closed) {
                throw new OperationAbortedError();
            }

            await slot.connector.connect({...waiter.options, abortSignal: waiter.controller.signal});

            if (waiter.cancelled || this.closed) {
                throw new OperationAbortedError();
            }

            this.creating.delete(waiter);
            this.active.add(slot);
            waiter.cleanup();
            waiter.resolve(this.lease(slot));
        } catch (error) {
            this.creating.delete(waiter);
            waiter.cleanup();

            if (slot) {
                await this.dispose(slot);
            } else {
                this.total--;
                this.changed();
            }

            if (!waiter.cancelled) {
                waiter.reject(error instanceof Error ? error : new ConnectionClosedError());
            }

            this.pump();
        }
    }

    private lease(slot: Slot<T>): ConnectionLease<T> {
        const pending = new Set<Promise<unknown>>();
        let closing = false;
        let releasePromise: Promise<void> | undefined;
        let interrupt!: (error: PoolClosedError) => void;
        const stopped = new Promise<never>((_resolve, reject) => {
            interrupt = reject;
        });
        const stopLease = () => interrupt(new PoolClosedError('The connection lease was forcibly closed'));

        void stopped.catch(() => {});
        slot.resources.add(stopLease);

        const track = <R>(promise: Promise<R>): Promise<R> => {
            pending.add(promise);
            void promise.catch(() => {
                slot.broken = true;
            }).finally(() => pending.delete(promise));

            return promise;
        };
        const discardValue = (value: unknown): void => {
            if (value instanceof Readable) {
                value.on('error', () => {});
                value.destroy(new PoolClosedError('The connection closed before the read became available'));

                return;
            }

            if (value && typeof value === 'object' && 'entries' in value && 'result' in value) {
                discardValue(value.entries);
                void Promise.resolve(value.result).catch(() => {});

                return;
            }

            if (value && typeof value === 'object' && Symbol.asyncIterator in value) {
                try {
                    const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();

                    void Promise.resolve(iterator.return?.()).catch(() => {});
                } catch {
                    // The transport has already been retired; late cleanup cannot make it reusable.
                }
            }
        };
        const trackValue = (value: unknown): unknown => {
            if (slot.retired) {
                discardValue(value);

                throw new PoolClosedError('The connection closed before the operation completed');
            }

            if (value instanceof Readable) {
                const stop = () => value.destroy(new PoolClosedError('The pool closed during a leased read'));

                slot.resources.add(stop);
                track(finished(value, {readable: true, writable: false, cleanup: true}).finally(() => {
                    slot.resources.delete(stop);
                }));

                return value;
            }

            if (
                value &&
                typeof value === 'object' &&
                'entries' in value &&
                'result' in value &&
                value.entries &&
                typeof value.entries === 'object' &&
                Symbol.asyncIterator in value.entries
            ) {
                return {...value, entries: trackValue(value.entries)};
            }

            if (value && typeof value === 'object' && Symbol.asyncIterator in value) {
                const iterator = (value as AsyncIterable<unknown>)[Symbol.asyncIterator]();
                let done!: () => void;
                let fail!: (error: unknown) => void;

                track(new Promise<void>((resolve, reject) => {
                    done = resolve;
                    fail = reject;
                }));

                let complete = false;
                let returning: Promise<IteratorResult<unknown>> | undefined;
                const finish = (...errors: unknown[]) => {
                    if (complete) {
                        return;
                    }

                    complete = true;
                    slot.resources.delete(stop);

                    if (errors.length) {
                        slot.broken = true;
                        fail(errors[0]);
                    } else {
                        done();
                    }
                };
                const requestReturn = (value?: unknown): Promise<IteratorResult<unknown>> => {
                    returning ??= Promise.resolve().then(() =>
                        iterator.return?.(value) ?? {done: true, value}).finally(() => {
                        returning = undefined;
                    });

                    return returning;
                };
                const stop = () => {
                    finish(new PoolClosedError('The pool closed during leased iteration'));
                    void requestReturn().catch(() => {});
                };
                const wrapped: AsyncIterableIterator<unknown> = {
                    [Symbol.asyncIterator]() {
                        return this;
                    },
                    async next(value?: unknown) {
                        if (slot.retired) {
                            throw new PoolClosedError('The connection lease was forcibly closed');
                        }

                        if (complete) {
                            return {done: true, value: undefined};
                        }

                        try {
                            const item = await Promise.race([iterator.next(value), stopped]);

                            if (item.done) {
                                finish();
                            }

                            return item;
                        } catch (error) {
                            finish(error);
                            throw error;
                        }
                    },
                    async return(value?: unknown) {
                        if (complete) {
                            return {done: true, value};
                        }

                        try {
                            const item = await Promise.race([requestReturn(value), stopped]);

                            if (item.done) {
                                finish();
                            }

                            return item;
                        } catch (error) {
                            finish(error);
                            throw error;
                        }
                    },
                    async throw(error?: unknown) {
                        if (slot.retired) {
                            throw new PoolClosedError('The connection lease was forcibly closed');
                        }

                        if (complete) {
                            throw error;
                        }

                        try {
                            if (!iterator.throw) {
                                await Promise.race([requestReturn(), stopped]);

                                throw error;
                            }

                            const item = await Promise.race([iterator.throw(error), stopped]);

                            if (item.done) {
                                finish();
                            }

                            return item;
                        } catch (failure) {
                            finish(failure);
                            throw failure;
                        }
                    },
                };

                slot.resources.add(stop);

                return wrapped;
            }

            return value;
        };
        const connector = new Proxy(slot.connector, {
            get(target, property) {
                const member = Reflect.get(target, property, target);

                if (typeof member !== 'function') {
                    return member;
                }

                return (...args: unknown[]) => {
                    if (closing || slot.retired) {
                        throw new PoolClosedError('This connection lease has been released');
                    }

                    try {
                        const value = Reflect.apply(member, target, args);

                        if (
                            value instanceof Promise ||
                            (value &&
                                typeof value === 'object' &&
                                typeof value.then === 'function')
                        ) {
                            const completion = Promise.resolve(value).then(trackValue);

                            return track(Promise.race([completion, stopped]));
                        }

                        return trackValue(value);
                    } catch (error) {
                        slot.broken = true;
                        throw error;
                    }
                };
            },
        });

        return {
            connector,
            release: () => {
                closing = true;
                releasePromise ??= (async () => {
                    while (pending.size) {
                        await Promise.allSettled([...pending]);
                    }

                    slot.resources.delete(stopLease);
                    this.active.delete(slot);

                    if (this.closed || slot.broken || slot.retired) {
                        await this.dispose(slot);
                    } else {
                        this.idle.push(slot);

                        if (this.idleTimeoutMs) {
                            slot.idleTimer = setTimeout(() => {
                                const index = this.idle.indexOf(slot);

                                if (index >= 0) {
                                    this.idle.splice(index, 1);
                                    void this.dispose(slot).then(() => this.pump());
                                }
                            }, this.idleTimeoutMs);
                            slot.idleTimer.unref();
                        }
                    }

                    this.changed();
                    this.pump();
                })();

                return releasePromise;
            },
        };
    }

    public async withConnection<R>(
        operation: (connector: T) => R | Promise<R>,
        options: ConnectorOperationOptions = {},
    ): Promise<R> {
        const lease = await this.acquire(options);

        try {
            return await operation(lease.connector);
        } finally {
            // Returned streams/iterators retain their lease asynchronously until consumed or explicitly destroyed.
            void lease.release();
        }
    }

    private dispose(slot: Slot<T>): Promise<void> {
        if (slot.disposal) {
            return slot.disposal;
        }

        slot.retired = true;
        clearTimeout(slot.idleTimer);
        this.active.delete(slot);

        const index = this.idle.indexOf(slot);

        if (index >= 0) {
            this.idle.splice(index, 1);
        }

        for (const stop of slot.resources) {
            try {
                stop();
            } catch {
                slot.broken = true;
            }
        }

        slot.resources.clear();
        slot.disposal = Promise.resolve().then(() => slot.connector.disconnect()).catch(() => {
            // A broken session is never reused, even when its close operation reports failure.
        }).finally(() => {
            // Closing transports continue to occupy their slot until disconnect has actually settled.
            this.total--;
            this.changed();
            this.pump();
        });

        return slot.disposal;
    }

    private changed(): void {
        for (const listener of this.closingListeners) {
            listener();
        }
    }

    public async close(options: {force?: boolean; timeoutMs?: number} = {}): Promise<void> {
        const timeoutMs = options.timeoutMs ?? 30000;

        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
            throw new RangeError('Pool close timeout must be an integer from 1 to 2147483647');
        }

        this.closed = true;

        return new Promise<void>((resolve, reject) => {
            const check = () => {
                if (!this.total) {
                    clearTimeout(timer);
                    this.closingListeners.delete(check);
                    resolve();
                }
            };
            const retireActive = () => {
                for (const slot of this.active) {
                    slot.broken = true;
                    void this.dispose(slot);
                }
            };
            const timer = setTimeout(() => {
                this.closingListeners.delete(check);
                retireActive();
                reject(new OperationTimeoutError('Pool close timed out; a connector is still being created or disconnected'));
            }, timeoutMs);

            this.closingListeners.add(check);

            for (const waiter of this.waiters.splice(0)) {
                waiter.cleanup();
                waiter.reject(new PoolClosedError('The connection pool closed while acquisition was queued'));
            }

            for (const waiter of this.creating) {
                waiter.abort();
            }

            for (const slot of [...this.idle]) {
                void this.dispose(slot);
            }

            if (options.force) {
                retireActive();
            }

            check();
        });
    }
}
