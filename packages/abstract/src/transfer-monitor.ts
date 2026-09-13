import {Transform, type TransformCallback} from 'node:stream';
import {resolveByteLimit} from './byte-limit.js';
import {OperationAbortedError, ResourceLimitError} from './errors.js';
import type {ConnectorOperationOptions} from './operation-options.js';

export type TransferDirection = 'upload' | 'download';

export interface TransferProgressEvent {
    readonly direction: TransferDirection;
    readonly path?: string;
    readonly attempt: number;
    readonly stage: 'starting' | 'transferring' | 'completed' | 'failed' | 'cancelled';
    readonly bytesTransferred: number;
    readonly totalBytes?: number;
    readonly elapsedMs: number;
    readonly bytesPerSecond: number;
}

interface BudgetWaiter {
    bytes: number;
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abort: () => void;
}

interface BudgetQueue {
    waiters: BudgetWaiter[];
    timer?: ReturnType<typeof setTimeout>;
    deadline: number;
}

/** FIFO byte quanta; a shared instance has an independent aggregate budget for each direction. */
export class BandwidthBudget {
    public readonly bytesPerSecond: number;

    public readonly burstBytes: number;

    private readonly queues: Record<TransferDirection, BudgetQueue> = {
        upload: {waiters: [], deadline: 0},
        download: {waiters: [], deadline: 0},
    };

    public constructor(options: {bytesPerSecond: number; burstBytes?: number}) {
        if (!Number.isFinite(options.bytesPerSecond) || options.bytesPerSecond < 1) {
            throw new RangeError('bytesPerSecond must be a finite number of at least one');
        }

        this.bytesPerSecond = options.bytesPerSecond;
        this.burstBytes = options.burstBytes ?? Math.max(1, Math.min(16384, Math.floor(this.bytesPerSecond / 10)));

        if (!Number.isSafeInteger(this.burstBytes) || this.burstBytes < 1 || this.burstBytes > 1048576) {
            throw new RangeError('burstBytes must be an integer from 1 to 1048576');
        }
    }

    public async consume(bytes: number, signal?: AbortSignal, direction: TransferDirection = 'upload'): Promise<void> {
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new RangeError('The bandwidth byte count must be a non-negative safe integer');
        }

        for (let remaining = bytes; remaining > 0;) {
            const quantum = Math.min(remaining, this.burstBytes);

            await this.wait(quantum, signal, direction);
            remaining -= quantum;
        }

        if (signal?.aborted) {
            throw new OperationAbortedError();
        }
    }

    private wait(bytes: number, signal: AbortSignal | undefined, direction: TransferDirection): Promise<void> {
        if (signal?.aborted) {
            return Promise.reject(new OperationAbortedError());
        }

        const queue = this.queues[direction];

        return new Promise((resolve, reject) => {
            const waiter: BudgetWaiter = {
                bytes,
                resolve,
                reject,
                signal,
                abort: () => {
                    const index = queue.waiters.indexOf(waiter);

                    if (index < 0) {
                        return;
                    }

                    queue.waiters.splice(index, 1);
                    signal?.removeEventListener('abort', waiter.abort);
                    reject(new OperationAbortedError());

                    if (index === 0) {
                        clearTimeout(queue.timer);
                        queue.timer = undefined;
                        this.schedule(queue);
                    }
                },
            };

            signal?.addEventListener('abort', waiter.abort, {once: true});
            queue.waiters.push(waiter);

            if (queue.waiters.length === 1) {
                this.schedule(queue);
            }
        });
    }

    private schedule(queue: BudgetQueue): void {
        const waiter = queue.waiters[0];

        if (!waiter) {
            return;
        }

        queue.deadline = performance.now() + waiter.bytes * 1000 / this.bytesPerSecond;

        const wake = () => {
            const remaining = queue.deadline - performance.now();

            if (remaining > 0) {
                queue.timer = setTimeout(wake, Math.min(2147483647, Math.max(1, Math.ceil(remaining))));

                return;
            }

            queue.waiters.shift();
            queue.timer = undefined;
            waiter.signal?.removeEventListener('abort', waiter.abort);
            waiter.resolve();
            this.schedule(queue);
        };

        wake();
    }
}

export interface TransferMonitor {
    readonly stream: Transform;
    complete(): void;
    fail(error?: unknown): void;
    dispose(): void;
}

export function createTransferMonitor(
    options: ConnectorOperationOptions,
    direction: TransferDirection,
    attempt: number,
    path?: string,
): TransferMonitor {
    if (options.totalBytes !== undefined && (!Number.isSafeInteger(options.totalBytes) || options.totalBytes < 0)) {
        throw new RangeError('totalBytes must be a non-negative safe integer');
    }

    const maxBytes = resolveByteLimit(options.maxBytes);
    const interval = options.progressIntervalMs ?? 100;

    if (!Number.isFinite(interval) || interval < 0) {
        throw new RangeError('progressIntervalMs must be non-negative and finite');
    }

    const budget = typeof options.bandwidth === 'number' ?
        new BandwidthBudget({bytesPerSecond: options.bandwidth}) : options.bandwidth;
    const cancellation = new AbortController();
    const started = performance.now();
    let transferred = 0;
    let lastEvent = -Infinity;
    let settled = false;

    const emit = (stage: TransferProgressEvent['stage']) => {
        const now = performance.now();

        if (stage === 'transferring' && now - lastEvent < interval) {
            return;
        }

        lastEvent = now;

        try {
            const returned = options.onProgress?.(Object.freeze({
                direction,
                path,
                attempt,
                stage,
                bytesTransferred: transferred,
                totalBytes: options.totalBytes,
                elapsedMs: now - started,
                bytesPerSecond: transferred * 1000 / Math.max(1, now - started),
            }));

            void Promise.resolve(returned).catch(() => {});
        } catch {
            // Observers cannot change transfer success or cause an ambiguous replay.
        }
    };

    const stream = new Transform({
        transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);

            if (bytes.length > maxBytes - transferred) {
                callback(new ResourceLimitError('The transfer exceeds maxBytes'));

                return;
            }

            void (async () => {
                await budget?.consume(bytes.length, cancellation.signal, direction);

                if (cancellation.signal.aborted) {
                    throw new OperationAbortedError();
                }

                transferred += bytes.length;
                emit('transferring');
                callback(null, bytes);
            })().catch(error => callback(error));
        },
    });

    const abort = () => stream.destroy(new OperationAbortedError());
    const dispose = () => {
        options.abortSignal?.removeEventListener('abort', abort);
        cancellation.abort();
    };
    const fail = (error?: unknown) => {
        if (!settled) {
            settled = true;
            emit(error instanceof OperationAbortedError || options.abortSignal?.aborted ? 'cancelled' : 'failed');
        }

        dispose();
    };

    stream.once('error', fail);
    stream.once('close', () => {
        if (!stream.readableEnded) {
            fail();
        }

        cancellation.abort();
    });
    options.abortSignal?.addEventListener('abort', abort, {once: true});
    emit('starting');

    if (options.abortSignal?.aborted) {
        abort();
    }

    return {
        stream,
        complete() {
            if (!settled) {
                settled = true;
                emit('completed');
            }

            dispose();
        },
        fail,
        dispose,
    };
}
