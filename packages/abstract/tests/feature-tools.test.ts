import {describe, expect, it, vi} from 'vitest';
import {Readable, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import type {StatEntry} from '@flystorage/file-storage';
import {
    BandwidthBudget, ConnectorPool, createTransferMonitor, describeCapabilities,
    checksumDetails, copyFileWithStrategy, publishFile, walk, classifyConnectionError, emitConnectionState,
    IntegrityError, ResourceLimitError, NotSupportedError, NotFoundError, OperationAbortedError,
    OperationTimeoutError, PoolClosedError, NameResolutionError, AuthError,
    type TransferContents, type RenameOptions,
} from '../src/index.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const consume = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
};

class MemoryRemote {
    public validatePublicationOptions(): void {}

    public files = new Map<string, Buffer>([['source', Buffer.from('hello')]]);

    public directories = new Set(['.']);

    public calls: string[] = [];

    public uploadFails = false;

    public mkdirFails = false;

    public renameFails = false;

    public extraDuringUpload = false;

    public connected = false;

    public closed = 0;

    public async connect(): Promise<void> {
        this.connected = true;
    }

    public async disconnect(): Promise<void> {
        this.connected = false;
        this.closed++;
    }

    public async read(path: string): Promise<Readable> {
        this.calls.push(`read:${path}`);

        if (!this.files.has(path)) {
            throw new NotFoundError('Missing fixture file');
        }

        return Readable.from([this.files.get(path)!]);
    }

    public async stat(path: string): Promise<StatEntry> {
        if (this.directories.has(path)) {
            return {
                type: 'directory',
                path,
                isFile: false,
                isDirectory: true,
            };
        }

        const content = this.files.get(path);

        if (!content) {
            throw new NotFoundError('Missing fixture file');
        }

        return {
            type: 'file',
            path,
            isFile: true,
            isDirectory: false,
            size: content.length,
        };
    }

    public async *list(path: string): AsyncGenerator<StatEntry> {
        this.calls.push(`list:${path}`);

        for (const directory of this.directories) {
            if (directory !== path && posix.dirname(directory) === path) {
                yield await this.stat(directory);
            }
        }

        for (const file of this.files.keys()) {
            if (posix.dirname(file) === path) {
                yield await this.stat(file);
            }
        }
    }

    public async write(path: string, contents: TransferContents): Promise<void> {
        this.calls.push(`write:${path}`);

        const source = typeof contents === 'function' ? await contents() : contents;

        this.files.set(path, await consume(source));

        if (this.extraDuringUpload) {
            this.files.set(posix.join(posix.dirname(path), 'unrelated'), Buffer.from('preserve'));
        }

        if (this.uploadFails) {
            throw new Error('Upload failed');
        }
    }

    public async createDirectoryExclusive(path: string): Promise<void> {
        this.calls.push(`mkdir:${path}`);

        if (this.mkdirFails || this.directories.has(path)) {
            throw new Error('Directory exists');
        }

        this.directories.add(path);
    }

    public async removeEmptyDirectory(path: string): Promise<void> {
        this.calls.push(`rmdir:${path}`);

        if ([...this.files.keys()].some(file => posix.dirname(file) === path)) {
            throw new Error('Not empty');
        }

        this.directories.delete(path);
    }

    public async deleteDirectory(): Promise<void> {
        throw new Error('Recursive deletion must never be used');
    }

    public async deleteFile(path: string): Promise<void> {
        this.calls.push(`delete:${path}`);
        this.files.delete(path);
    }

    public async renameFile(from: string, to: string, options: RenameOptions): Promise<{atomic: boolean}> {
        this.calls.push(`rename:${from}:${to}`);

        if (options.overwrite === 'fail' && this.files.has(to)) {
            throw new Error('Destination exists');
        }

        this.files.set(to, this.files.get(from)!);
        this.files.delete(from);

        if (this.renameFails) {
            throw new Error('Final reply lost');
        }

        return {atomic: true};
    }
}

describe('progress, bandwidth and ordinary typed connection failures', () => {
    it('reports exact bytes, unknown totals, and completion only when explicitly confirmed', async () => {
        const events: Array<{
            stage: string;
            bytesTransferred: number;
            totalBytes?: number;
            attempt: number;
        }> = [];
        const monitor = createTransferMonitor({onProgress: event => events.push(event), progressIntervalMs: 0}, 'upload', 2);

        await pipeline(Readable.from([Buffer.alloc(12), Buffer.alloc(7)]), monitor.stream, new Writable({
            write(_chunk, _encoding, callback) {
                callback();
            },
        }));

        expect(events.some(event => event.stage === 'completed')).toBe(false);
        monitor.complete();
        expect(events.at(-1)).toMatchObject({stage: 'completed', bytesTransferred: 19, attempt: 2});
        expect(events.every(event => event.totalBytes === undefined)).toBe(true);
        expect(events.map(event => event.bytesTransferred)).toEqual([0, 12, 19, 19]);
    });

    it('observer exceptions including async rejections cannot affect success', async () => {
        const monitor = createTransferMonitor({
            onProgress: async () => {
                throw new Error('Observer failed');
            },
        }, 'download', 1);

        emitConnectionState(async () => {
            throw new Error('Observer failed');
        }, {state: 'ready', protocol: 'ftp', attempt: 1});
        monitor.stream.end('data');
        expect((await consume(monitor.stream)).toString()).toBe('data');
        monitor.complete();
        await tick();
    });

    it('shares a rate budget and cancels queued waits without stalling another transfer', async () => {
        const budget = new BandwidthBudget({bytesPerSecond: 20000, burstBytes: 1000});
        const started = performance.now();

        await Promise.all([budget.consume(1000), budget.consume(1000)]);
        expect(performance.now() - started).toBeGreaterThanOrEqual(90);

        const cancellation = new AbortController();
        const blocked = budget.consume(10000, cancellation.signal);
        const rejection = expect(blocked).rejects.toBeInstanceOf(OperationAbortedError);

        cancellation.abort();
        await rejection;
        await budget.consume(1);
    });

    it('disposing a throttled monitor cancels its timer without a completion event', async () => {
        const events: string[] = [];
        const monitor = createTransferMonitor({bandwidth: 1, onProgress: event => events.push(event.stage)}, 'upload', 1);
        const transfer = pipeline(Readable.from([Buffer.alloc(100)]), monitor.stream, new Writable({
            write(_chunk, _encoding, callback) {
                callback();
            },
        }));
        const rejected = expect(transfer).rejects.toBeInstanceOf(OperationAbortedError);

        await tick();
        monitor.dispose();
        await rejected;
        expect(events).not.toContain('completed');
    });

    it('preserves catchable timeout/cancellation/auth classes and classifies DNS separately', () => {
        for (const error of [new OperationTimeoutError(), new OperationAbortedError(), new AuthError('Rejected')]) {
            expect(classifyConnectionError(error, 'credentials')).toBe(error);
        }

        expect(classifyConnectionError(Object.assign(new Error('DNS failed'), {code: 'ENOTFOUND'}), 'connect'))
            .toBeInstanceOf(NameResolutionError);
    });
});

describe('bounded pool leases', () => {
    it('counts transfers and directory work against the same server-adjusted limit', async () => {
        const pool = new ConnectorPool({create: () => new MemoryRemote(), maxConnections: 4, serverMaxConnections: 1});
        const stream = await pool.withConnection(connector => connector.read('source'));
        let listed = false;
        const listing = pool.withConnection(async connector => {
            for await (const _entry of connector.list('.')) {
                listed = true;
            }
        });

        await tick();
        expect(listed).toBe(false);
        expect(pool.stats).toMatchObject({
            limit: 1,
            connections: 1,
            active: 1,
            queued: 1,
        });
        await consume(stream);
        await listing;
        await pool.close();
        expect(pool.stats.connections).toBe(0);
    });

    it('supports multiple independent simultaneous sessions without exceeding the configured bound', async () => {
        const pool = new ConnectorPool({create: () => new MemoryRemote(), maxConnections: 2});
        const first = await pool.acquire();
        const second = await pool.acquire();

        expect(first.connector).not.toBe(second.connector);
        expect(pool.stats.connections).toBe(2);
        await expect(pool.acquire({timeoutMs: 10})).rejects.toBeInstanceOf(OperationTimeoutError);
        await first.release();
        await second.release();
        await pool.close();
    });

    it('removes cancelled waiters fairly and rejects calls after releasing a lease', async () => {
        const pool = new ConnectorPool({create: () => new MemoryRemote(), maxConnections: 1});
        const lease = await pool.acquire();
        const cancellation = new AbortController();
        const waiting = pool.acquire({abortSignal: cancellation.signal});
        const rejection = expect(waiting).rejects.toBeInstanceOf(OperationAbortedError);

        cancellation.abort();
        await rejection;
        await lease.release();
        expect(() => lease.connector.stat('source')).toThrow(PoolClosedError);
        await pool.withConnection(connector => connector.stat('source'));
        await pool.close();
    });

    it('holds returned iterators and permits return before their first next', async () => {
        const pool = new ConnectorPool({create: () => new MemoryRemote(), maxConnections: 1});
        const iterator = await pool.withConnection(connector => connector.list('.'));

        expect(pool.stats.active).toBe(1);
        await iterator.return(undefined);
        await tick();
        expect(pool.stats.active).toBe(0);
        await pool.close();
    });

    it('force close destroys returned reads and releases their sessions', async () => {
        const pool = new ConnectorPool({create: () => new MemoryRemote(), maxConnections: 1});
        const stream = await pool.withConnection(connector => connector.read('source'));

        await pool.close({force: true, timeoutMs: 200});
        expect(stream.destroyed).toBe(true);
        expect(pool.stats.connections).toBe(0);
    });

    it('does not leak a connector created after its acquisition was cancelled', async () => {
        let supply!: (connector: MemoryRemote) => void;
        const remote = new MemoryRemote();
        const pool = new ConnectorPool({
            create: () => new Promise<MemoryRemote>(resolve => {
                supply = resolve;
            }),
        });
        const cancellation = new AbortController();
        const acquiring = pool.acquire({abortSignal: cancellation.signal});
        const rejection = expect(acquiring).rejects.toBeInstanceOf(OperationAbortedError);

        cancellation.abort();
        await rejection;
        supply(remote);
        await tick();
        expect(remote.connected).toBe(false);
        expect(remote.closed).toBe(1);
        await pool.close();
    });
});

describe('integrity, publication and explicit copying', () => {
    it('streams exact digests only with explicit fallback and rejects unsupported server-only hashing', async () => {
        const remote = new MemoryRemote();

        await expect(checksumDetails(remote, 'source')).rejects.toBeInstanceOf(NotSupportedError);
        expect(await checksumDetails(remote, 'source', {strategy: 'stream'})).toEqual({
            algorithm: 'sha256',
            strategy: 'stream',
            digest: createHash('sha256').update('hello').digest('hex'),
            bytesRead: 5,
        });
        await expect(checksumDetails(remote, 'source', {strategy: 'stream', maxBytes: 4}))
            .rejects.toBeInstanceOf(ResourceLimitError);
    });

    it('does not turn failed server hashing into an implicit download', async () => {
        const remote = new MemoryRemote();
        const serverChecksum = vi.fn().mockRejectedValue(new OperationTimeoutError());

        await expect(checksumDetails(Object.assign(remote, {serverChecksum}), 'source', {strategy: 'server-or-stream'}))
            .rejects.toBeInstanceOf(OperationTimeoutError);
        expect(remote.calls).not.toContain('read:source');
    });

    it('rejects a truncated read and never returns a completed digest', async () => {
        const remote = new MemoryRemote();

        remote.read = async () => Readable.from(['hel']);
        await expect(checksumDetails(remote, 'source', {strategy: 'stream'})).rejects.toBeInstanceOf(IntegrityError);
    });

    it('publishes verified bytes only after upload and preserves ordinary source files', async () => {
        const remote = new MemoryRemote();
        const digest = createHash('sha256').update('replacement').digest('hex');
        const result = await publishFile(remote, 'destination', Readable.from(['replacement']), {
            verify: {expectedDigest: digest},
        });

        expect(result).toMatchObject({atomic: true, verified: true, cleanup: 'done'});
        expect(remote.files.get('destination')?.toString()).toBe('replacement');
        expect(remote.files.get('source')?.toString()).toBe('hello');
        expect(remote.directories.size).toBe(1);
    });

    it('never writes or cleans a colliding staging directory', async () => {
        const remote = new MemoryRemote();

        remote.mkdirFails = true;
        await expect(publishFile(remote, 'destination', Readable.from(['x']))).rejects.toMatchObject({
            state: {
                phase: 'prepare',
                outcome: 'not-published',
                cleanup: 'done',
                temporaryPath: undefined,
            },
        });
        expect(remote.calls).toHaveLength(1);
    });

    it('failed uploads clean only owned files and leave unrelated files untouched', async () => {
        const remote = new MemoryRemote();

        remote.uploadFails = true;
        remote.extraDuringUpload = true;
        await expect(publishFile(remote, 'destination', Readable.from(['partial']))).rejects.toMatchObject({
            state: {phase: 'upload', outcome: 'not-published', cleanup: 'failed'},
        });
        expect(remote.files.has('destination')).toBe(false);
        expect([...remote.files.keys()].some(path => path.endsWith('/unrelated'))).toBe(true);
        expect([...remote.files.keys()].some(path => path.endsWith('/contents'))).toBe(false);
    });

    it('lost rename acknowledgement retains recovery state and does not retry or remove the destination', async () => {
        const remote = new MemoryRemote();

        remote.renameFails = true;
        await expect(publishFile(remote, 'destination', Readable.from(['data']))).rejects.toMatchObject({
            state: {phase: 'rename', outcome: 'uncertain', cleanup: 'retained'},
        });
        expect(remote.files.get('destination')?.toString()).toBe('data');
        expect(remote.calls.filter(call => call.startsWith('rename:'))).toHaveLength(1);
        expect(remote.calls.some(call => call.startsWith('delete:'))).toBe(false);
    });

    it('copies through bounded local staging and returns the actual strategy', async () => {
        const remote = new MemoryRemote();
        const result = await copyFileWithStrategy(remote, 'source', 'destination');

        expect(result).toMatchObject({strategy: 'client-streamed', bytesCopied: 5});
        expect(remote.files.get('destination')).toEqual(remote.files.get('source'));
        await expect(copyFileWithStrategy(remote, 'source', 'copy', {strategy: 'server-native'}))
            .rejects.toBeInstanceOf(NotSupportedError);
        await expect(copyFileWithStrategy(remote, 'source', 'copy', {maxBytes: 4}))
            .rejects.toBeInstanceOf(ResourceLimitError);
    });
});

describe('bounded traversal and discovery', () => {
    it('prunes excluded subtrees and counts examined entries before filtering', async () => {
        const remote = new MemoryRemote();

        remote.directories.add('skip');
        remote.files.set('skip/secret', Buffer.from('x'));

        const traversal = walk(remote, '.', {filter: entry => entry.path !== 'skip'});
        const output: string[] = [];

        for await (const entry of traversal.entries) {
            output.push(entry.path);
        }

        expect(output).toEqual(['source']);
        expect(remote.calls).not.toContain('list:skip');
        expect(await traversal.result).toEqual({complete: true, reason: 'complete', entries: 2});
    });

    it('distinguishes entry/depth exhaustion and early consumer exit from a complete inventory', async () => {
        const remote = new MemoryRemote();

        remote.directories.add('nested');

        const bounded = walk(remote, '.', {maxEntries: 1});

        for await (const _entry of bounded.entries) {
            // Consume the bounded inventory.
        }

        expect(await bounded.result).toMatchObject({complete: false, reason: 'max-entries', entries: 1});

        const depth = walk(remote, '.', {maxDepth: 0});

        for await (const _entry of depth.entries) {
            // No request is needed when the root depth is outside the budget.
        }

        expect(await depth.result).toMatchObject({complete: false, reason: 'max-depth'});

        const early = walk(remote, '.');

        for await (const _entry of early.entries) {
            break;
        }

        expect(await early.result).toMatchObject({complete: false, reason: 'consumer-stopped'});
    });

    it('reports cancellation without a successful empty result', async () => {
        const controller = new AbortController();
        const traversal = walk(new MemoryRemote(), '.', {abortSignal: controller.signal});

        controller.abort();
        await expect(traversal.entries.next()).rejects.toBeInstanceOf(OperationAbortedError);
        expect(await traversal.result).toMatchObject({complete: false, reason: 'cancelled'});
    });

    it('settles traversal completion when returned before the first read', async () => {
        const traversal = walk(new MemoryRemote(), '.');

        await traversal.entries.return(undefined);
        expect(await traversal.result).toMatchObject({complete: false, reason: 'consumer-stopped', entries: 0});
    });

    it('separates adapter capability from unknown server support without any probe', () => {
        const report = describeCapabilities('ftp');

        expect(report.negotiated).toBe(false);
        expect(report.adapter.streamChecksum.state).toBe('supported');
        expect(report.server.checksum.state).toBe('unknown');
        expect(report.adapter.atomicReplace.state).toBe('unsupported');
        expect(describeCapabilities('ftp', ['HASH SHA-256;SHA-512;']).server.checksum.algorithms)
            .toEqual(['sha256', 'sha512']);
    });
});
