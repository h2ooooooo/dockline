import {resolveByteLimit} from './byte-limit.js';
import {createHash, randomUUID} from 'node:crypto';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, posix} from 'node:path';
import type {StatEntry, StorageAdapter} from '@flystorage/file-storage';
import type {ConnectorOperationOptions, TransferContents} from './operation-options.js';
import {IntegrityError, NotSupportedError, NotFoundError, OperationAbortedError, PublicationError, ResourceLimitError} from './errors.js';

export interface TransferConnector extends Pick<StorageAdapter,
    'read' | 'stat' | 'list' | 'deleteFile' | 'deleteDirectory'> {
    validatePublicationOptions(options: PublishFileOptions): void;
    write(path: string, contents: TransferContents, options: ConnectorOperationOptions): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: RenameOptions): Promise<{atomic: boolean}>;
    serverChecksum?(path: string, algorithm: 'sha256' | 'sha512', options: ConnectorOperationOptions): Promise<string>;
}

export interface RenameOptions extends ConnectorOperationOptions {
    overwrite: 'fail' | 'replace';
    requireAtomicRename?: boolean;
}

export interface ChecksumDetailsOptions extends ConnectorOperationOptions {
    algorithm?: string;
    strategy?: 'server-only' | 'stream' | 'server-or-stream';
}

export interface ChecksumResult {
    readonly algorithm: 'sha256' | 'sha512';
    readonly strategy: 'server' | 'stream';
    readonly digest: string;
    readonly bytesRead?: number;
}

export function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new OperationAbortedError();
    }
}

export function toReadable(contents: Awaited<ReturnType<StorageAdapter['read']>>): Readable {
    if (contents instanceof Readable) {
        return contents;
    }

    if (typeof contents === 'string' || Buffer.isBuffer(contents)) {
        return Readable.from([contents]);
    }

    if (Symbol.asyncIterator in contents || Symbol.iterator in contents) {
        return Readable.from(contents as AsyncIterable<Buffer>);
    }

    throw new TypeError('The connector must supply a readable stream or iterable');
}

export async function checksumDetails(
    connector: Pick<TransferConnector, 'read' | 'stat' | 'serverChecksum'>,
    path: string,
    options: ChecksumDetailsOptions = {},
): Promise<ChecksumResult> {
    const algorithm = options.algorithm ?? 'sha256';
    const strategy = options.strategy ?? 'server-only';
    const maxBytes = resolveByteLimit(options.maxBytes);

    if (algorithm !== 'sha256' && algorithm !== 'sha512') {
        throw new NotSupportedError('Checksums support sha256 or sha512');
    }

    if (!['server-only', 'stream', 'server-or-stream'].includes(strategy)) {
        throw new TypeError('Unknown checksum strategy');
    }

    checkAbort(options.abortSignal);

    if (strategy !== 'stream') {
        try {
            if (!connector.serverChecksum) {
                throw new NotSupportedError('This connector has no server checksum implementation');
            }

            const digest = await connector.serverChecksum(path, algorithm, options);
            const length = algorithm === 'sha256' ? 64 : 128;

            if (!new RegExp(`^[a-fA-F0-9]{${length}}$`).test(digest)) {
                throw new IntegrityError('The server returned an invalid digest');
            }

            return Object.freeze({algorithm, strategy: 'server', digest: digest.toLowerCase()});
        } catch (error) {
            if (!(error instanceof NotSupportedError) || strategy === 'server-only') {
                throw error;
            }
        }
    }

    const before = await connector.stat(path, options);

    if (before.type !== 'file') {
        throw new NotSupportedError('Only regular files can be checksummed');
    }

    if (before.size !== undefined && before.size > maxBytes) {
        throw new ResourceLimitError('The checksum exceeds maxBytes');
    }

    const hash = createHash(algorithm);
    const stream = toReadable(await connector.read(path, options));
    const abort = () => stream.destroy(new OperationAbortedError());
    let bytesRead = 0;

    options.abortSignal?.addEventListener('abort', abort, {once: true});

    try {
        checkAbort(options.abortSignal);

        for await (const part of stream) {
            checkAbort(options.abortSignal);

            const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);

            bytesRead += bytes.length;

            if (bytesRead > maxBytes) {
                throw new ResourceLimitError('The checksum exceeds maxBytes');
            }

            hash.update(bytes);
        }

        checkAbort(options.abortSignal);

        if (before.size !== undefined && before.size !== bytesRead) {
            throw new IntegrityError('Remote content length changed or the checksum read was incomplete');
        }

        return Object.freeze({
            algorithm,
            strategy: 'stream',
            digest: hash.digest('hex'),
            bytesRead,
        });
    } finally {
        options.abortSignal?.removeEventListener('abort', abort);
        stream.destroy();
    }
}

export interface PublishFileOptions extends ConnectorOperationOptions {
    overwrite?: 'fail' | 'replace';
    requireAtomicRename?: boolean;
    verify?: {algorithm?: 'sha256' | 'sha512'; expectedDigest: string; maxBytes?: number};
    /** Remove only the directory created by this call; uncertain renames always retain it. */
    cleanupOnFailure?: boolean;
}

export interface PublicationResult {
    readonly destination: string;
    readonly atomic: boolean;
    readonly verified: boolean;
    readonly cleanup: 'done' | 'failed';
    readonly temporaryPath?: string;
}

export async function publishFile(
    connector: TransferConnector,
    destination: string,
    contents: TransferContents,
    options: PublishFileOptions = {},
): Promise<PublicationResult> {
    resolveByteLimit(options.maxBytes);
    resolveByteLimit(options.verify?.maxBytes);
    checkAbort(options.abortSignal);
    connector.validatePublicationOptions(options);

    if (!destination || /[\r\n\0]/.test(destination) || ['.', '..', '/'].includes(posix.basename(destination))) {
        throw new TypeError('Publication requires a file destination');
    }

    const overwrite = options.overwrite ?? 'fail';

    if (overwrite !== 'fail' && overwrite !== 'replace') {
        throw new TypeError('overwrite must be fail or replace');
    }

    if (options.verify) {
        const algorithm = options.verify.algorithm ?? 'sha256';
        const length = algorithm === 'sha256' ? 64 : algorithm === 'sha512' ? 128 : 0;

        if (!length || !new RegExp(`^[a-fA-F0-9]{${length}}$`).test(options.verify.expectedDigest)) {
            throw new TypeError('Verification requires a valid expected sha256 or sha512 digest');
        }
    }

    const directory = posix.join(posix.dirname(destination), `.dockline-upload-${randomUUID()}`);
    const temporaryPath = posix.join(directory, 'contents');
    let owned = false;
    let phase: PublicationError['state']['phase'] = 'prepare';
    let outcome: PublicationError['state']['outcome'] = 'not-published';

    try {
        // Exclusive mkdir is the ownership boundary; a collision never grants cleanup or write permission.
        await connector.createDirectoryExclusive(directory, {...options, autoReconnect: false, maxTransientRetries: 0});
        owned = true;
        phase = 'upload';
        await connector.write(temporaryPath, contents, options);
        checkAbort(options.abortSignal);

        if (options.verify) {
            phase = 'verify';

            const actual = await checksumDetails(connector, temporaryPath, {
                ...options,
                ...options.verify,
                maxBytes: options.verify.maxBytes === undefined ? options.maxBytes : options.verify.maxBytes,
                strategy: 'server-or-stream',
            });

            if (actual.digest !== options.verify.expectedDigest.toLowerCase()) {
                throw new IntegrityError('The staged upload did not match its expected digest');
            }
        }

        checkAbort(options.abortSignal);
        phase = 'rename';

        const renamed = await connector.renameFile(temporaryPath, destination, {
            ...options,
            overwrite,
            autoReconnect: false,
            maxTransientRetries: 0,
        });

        outcome = 'published';
        phase = 'cleanup';

        try {
            await connector.removeEmptyDirectory(directory, {timeoutMs: 5000, maxTransientRetries: 0});

            return Object.freeze({
                destination,
                atomic: renamed.atomic,
                verified: Boolean(options.verify),
                cleanup: 'done',
            });
        } catch {
            return Object.freeze({
                destination,
                atomic: renamed.atomic,
                verified: Boolean(options.verify),
                cleanup: 'failed',
                temporaryPath: directory,
            });
        }
    } catch (error) {
        // A missing final reply cannot establish whether the server completed a rename.
        if (phase === 'rename' && !(error instanceof NotSupportedError)) {
            outcome = 'uncertain';
        }

        let cleanup: PublicationError['state']['cleanup'] = owned ? 'retained' : 'done';

        if (owned && outcome === 'not-published' && options.cleanupOnFailure !== false) {
            try {
                try {
                    await connector.deleteFile(temporaryPath, {timeoutMs: 5000, maxTransientRetries: 0});
                } catch (cleanupError) {
                    if (!(cleanupError instanceof NotFoundError)) {
                        throw cleanupError;
                    }
                }

                await connector.removeEmptyDirectory(directory, {timeoutMs: 5000, maxTransientRetries: 0});
                cleanup = 'done';
            } catch {
                cleanup = 'failed';
            }
        }

        throw new PublicationError('File publication failed; inspect the recorded publication state', Object.freeze({
            destination,
            temporaryPath: owned ? temporaryPath : undefined,
            phase,
            outcome,
            cleanup,
        }));
    }
}

export interface CopyStrategyOptions extends PublishFileOptions {
    strategy?: 'auto' | 'client-streamed' | 'server-native';
    onStrategy?: (result: CopyResult) => void;
}

export interface CopyResult {
    readonly strategy: 'client-streamed';
    readonly bytesCopied: number;
    readonly publication: PublicationResult;
}

/** Disk staging keeps a single leased FTP session and bounds memory, including when used through a pool. */
export async function copyFileWithStrategy(
    connector: TransferConnector,
    from: string,
    to: string,
    options: CopyStrategyOptions = {},
): Promise<CopyResult> {
    resolveByteLimit(options.verify?.maxBytes);

    const strategy = options.strategy ?? 'auto';
    const maxBytes = resolveByteLimit(options.maxBytes);

    if (strategy === 'server-native') {
        throw new NotSupportedError('Server-native copying is not implemented by these adapters');
    }

    if (strategy !== 'auto' && strategy !== 'client-streamed') {
        throw new TypeError('Unknown copy strategy');
    }

    if (posix.normalize(from) === posix.normalize(to)) {
        throw new TypeError('Copy source and destination must differ');
    }

    checkAbort(options.abortSignal);

    connector.validatePublicationOptions(options);

    const metadata = await connector.stat(from, options);

    if (metadata.type !== 'file') {
        throw new NotSupportedError('Only regular files can be copied');
    }

    if (metadata.size !== undefined && metadata.size > maxBytes) {
        throw new ResourceLimitError('The copy exceeds maxBytes');
    }

    const directory = await mkdtemp(join(tmpdir(), 'dockline-copy-'));
    const localPath = join(directory, 'contents');
    let bytesCopied = 0;

    try {
        const input = toReadable(await connector.read(from, options));
        const bounded = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                bytesCopied += chunk.length;
                callback(bytesCopied > maxBytes ? new ResourceLimitError('The copy exceeds maxBytes') : null, chunk);
            },
        });

        await pipeline(input, bounded, createWriteStream(localPath, {flags: 'wx', mode: 0o600}), {
            signal: options.abortSignal,
        });

        if (metadata.size !== undefined && bytesCopied !== metadata.size) {
            throw new IntegrityError('The copy source changed length or its read was incomplete');
        }

        const publication = await publishFile(connector, to, () => createReadStream(localPath), options);
        const result = Object.freeze({strategy: 'client-streamed' as const, bytesCopied, publication});

        try {
            const returned = options.onStrategy?.(result);

            void Promise.resolve(returned).catch(() => {});
        } catch {
            // Strategy reporting is observational, just like progress reporting.
        }

        return result;
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
}

async function awaitWalkFilter(
    filter: () => boolean | Promise<boolean>, abortSignal?: AbortSignal,
): Promise<boolean> {
    checkAbort(abortSignal);

    let abort: () => void = () => {};

    try {
        return await new Promise<boolean>((resolve, reject) => {
            abort = () => reject(new OperationAbortedError('Directory walk filter was cancelled'));
            abortSignal?.addEventListener('abort', abort, {once: true});

            // Both handlers remain attached to consume a callback rejection arriving after cancellation.
            void Promise.resolve().then(() => {
                checkAbort(abortSignal);

                return filter();
            }).then(resolve, reject);
        });
    } finally {
        abortSignal?.removeEventListener('abort', abort);
    }
}

export interface WalkOptions extends ConnectorOperationOptions {
    maxDepth?: number;
    maxEntries?: number;
    filter?: (entry: StatEntry, depth: number) => boolean | Promise<boolean>;
}

export interface WalkResult {
    readonly complete: boolean;
    readonly reason: 'complete' | 'max-depth' | 'max-entries' | 'cancelled' | 'consumer-stopped' | 'failed';
    readonly entries: number;
}

export function walk(connector: Pick<TransferConnector, 'list'>, root: string, options: WalkOptions = {}): {
    entries: AsyncGenerator<StatEntry>;
    result: Promise<WalkResult>;
} {
    const maxDepth = options.maxDepth ?? 32;
    const maxEntries = options.maxEntries ?? 100000;

    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 0) {
        throw new RangeError('Walk budgets must be non-negative safe integers');
    }

    let settle!: (result: WalkResult) => void;
    const result = new Promise<WalkResult>(resolve => {
        settle = resolve;
    });
    let started = false;

    async function* entries(): AsyncGenerator<StatEntry> {
        started = true;

        const directories = [{path: root, depth: 0}];
        let count = 0;
        let exhaustedDepth = false;
        let reason: WalkResult['reason'] = 'consumer-stopped';

        try {
            while (directories.length) {
                checkAbort(options.abortSignal);

                const directory = directories.pop()!;

                if (directory.depth >= maxDepth) {
                    exhaustedDepth = true;
                    continue;
                }

                if (count >= maxEntries) {
                    reason = 'max-entries';

                    return;
                }

                for await (const entry of connector.list(directory.path, {...options, deep: false})) {
                    checkAbort(options.abortSignal);

                    if (count >= maxEntries) {
                        reason = 'max-entries';

                        return;
                    }

                    count++;

                    if (options.filter) {
                        const filter = options.filter;
                        const accepted = await awaitWalkFilter(
                            () => filter(entry, directory.depth + 1), options.abortSignal,
                        );

                        checkAbort(options.abortSignal);

                        if (!accepted) {
                            continue;
                        }
                    }

                    checkAbort(options.abortSignal);

                    yield entry;

                    const flags = entry as StatEntry & {isSymbolicLink?: boolean; isUnsupported?: boolean};

                    if (entry.type === 'directory' && !flags.isSymbolicLink && !flags.isUnsupported) {
                        directories.push({path: entry.path, depth: directory.depth + 1});
                    }
                }
            }

            reason = exhaustedDepth ? 'max-depth' : 'complete';
        } catch (error) {
            reason = options.abortSignal?.aborted || error instanceof OperationAbortedError ? 'cancelled' : 'failed';
            throw error;
        } finally {
            settle(Object.freeze({complete: reason === 'complete', reason, entries: count}));
        }
    }

    const iterator = entries();
    const finish = iterator.return.bind(iterator);
    const fail = iterator.throw.bind(iterator);

    iterator.return = async value => {
        if (!started) {
            settle(Object.freeze({complete: false, reason: 'consumer-stopped', entries: 0}));
        }

        return finish(value);
    };

    iterator.throw = async error => {
        if (!started) {
            settle(Object.freeze({
                complete: false,
                reason: options.abortSignal?.aborted || error instanceof OperationAbortedError ? 'cancelled' : 'failed',
                entries: 0,
            }));
        }

        return fail(error);
    };

    return {entries: iterator, result};
}
