import {createReadStream, createWriteStream} from 'node:fs';
import {link, mkdtemp, rename, rmdir, stat, unlink} from 'node:fs/promises';
import path from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createConnector} from './client-loader.js';
import {
    ConnectorPool, IntegrityError, NotSupportedError, OperationAbortedError,
    ResourceLimitError, resolveByteLimit,
    checkAbort, toReadable,
    type ConnectorOperationOptions, type TransferContents, type PoolOptions,
    type PublishFileOptions, type ChecksumDetailsOptions, type CopyStrategyOptions, type RenameOptions,
    type WalkOptions, type TransferAdapter, type TransferConfig, type TransferProtocol,
} from '@dockline/abstract';

export {createConnector} from './client-loader.js';
export type {FtpTransferConfig, SftpTransferConfig, TransferConfig, TransferProtocol, TransferAdapter} from '@dockline/abstract';

export interface UploadFileOptions extends ConnectorOperationOptions {
    /** Ordinary uploads replace an existing remote file. Fail requires a supported no-replace publication. */
    overwrite?: 'replace' | 'fail';
}

export interface DownloadFileOptions extends ConnectorOperationOptions {
    /** A completed download replaces the destination only when explicitly selected. */
    overwrite?: 'replace' | 'fail';
}

export interface TransferListOptions extends ConnectorOperationOptions {
    deep?: boolean;
}

function hasInvalidPathCharacters(value: string): boolean {
    return Array.from(value).some(character => {
        const code = character.charCodeAt(0);

        return code <= 31 || code === 127 || code === 92;
    });
}

/** SDK paths are relative to the configured root, independently of the local operating system. */
export function relativeRemotePath(value: string, allowRoot = false): string {
    if (typeof value !== 'string' || hasInvalidPathCharacters(value) || value.startsWith('/')) {
        throw new TypeError('Remote paths must be relative and use forward slashes');
    }

    if (Buffer.from(value, 'utf8').toString('utf8') !== value || /^[a-zA-Z]:/.test(value)) {
        throw new TypeError('Remote paths must be valid Unicode without a drive prefix');
    }

    const segments = value.split('/');

    if (segments.includes('..')) {
        throw new TypeError('Remote paths cannot traverse above the configured root');
    }

    const normalized = segments.filter(segment => segment !== '' && segment !== '.').join('/');

    if (!normalized && !allowRoot) {
        throw new TypeError('A remote file path is required');
    }

    return normalized || '.';
}

async function removeOwnedDownload(file: string, directory: string): Promise<void> {
    await unlink(file).catch(error => {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    });
    await rmdir(directory);
}

/** A small API over one explicit transport session. Advanced adapters remain directly accessible. */
export class Dockline {
    public readonly connector: TransferAdapter;

    private readonly defaultSignal?: AbortSignal;

    private readonly defaultMaxBytes: number;

    private readonly description: {
        protocol: TransferProtocol;
        host: string;
        port: number;
        root: string;
    };

    public constructor(config: TransferConfig) {
        this.connector = createConnector(config);
        this.defaultSignal = config.abortSignal;
        this.defaultMaxBytes = resolveByteLimit(config.maxBytes);
        this.description = {
            protocol: config.protocol,
            host: config.host,
            port: config.port ?? (config.protocol === 'sftp' ? 22 : config.protocol === 'ftps-implicit' ? 990 : 21),
            root: config.root ?? '',
        };
    }

    public static create(config: TransferConfig): Dockline {
        return new Dockline(config);
    }

    public static async connect(config: TransferConfig): Promise<Dockline> {
        const transfer = new Dockline(config);

        try {
            await transfer.connect();

            return transfer;
        } catch (error) {
            await transfer.disconnect().catch(cleanup => {
                throw new AggregateError([error, cleanup], 'Connection and cleanup failed');
            });

            throw error;
        }
    }

    public static async withConnection<T>(
        config: TransferConfig,
        callback: (remote: Dockline) => Promise<T>,
    ): Promise<T> {
        const transfer = new Dockline(config);
        let result: T;

        try {
            await transfer.connect();
            result = await callback(transfer);
        } catch (error) {
            await transfer.disconnect().catch(cleanup => {
                throw new AggregateError([error, cleanup], 'Operation and connection cleanup failed');
            });

            throw error;
        }

        await transfer.disconnect();

        return result;
    }

    public static createPool(
        config: TransferConfig,
        options: Omit<PoolOptions<Dockline>, 'create'> = {},
    ): ConnectorPool<Dockline> {
        return new ConnectorPool({...options, create: () => new Dockline(config)});
    }

    public toJSON(): object {
        return {...this.description};
    }

    public async connect(options: ConnectorOperationOptions = {}): Promise<void> {
        await this.connector.connect(options);
    }

    public async disconnect(): Promise<void> {
        await this.connector.disconnect();
    }

    public list(remotePath = '.', options: TransferListOptions = {}) {
        return this.connector.list(relativeRemotePath(remotePath, true), {deep: false, ...options});
    }

    public stat(remotePath: string, options: ConnectorOperationOptions = {}) {
        return this.connector.stat(relativeRemotePath(remotePath, true), options);
    }

    public async read(remotePath: string, options: ConnectorOperationOptions = {}): Promise<Readable> {
        return toReadable(await this.connector.read(relativeRemotePath(remotePath), options));
    }

    public async write(
        remotePath: string,
        contents: string | Buffer | TransferContents,
        options: ConnectorOperationOptions = {},
    ): Promise<void> {
        const source = typeof contents === 'string' || Buffer.isBuffer(contents) ? () => Readable.from([contents]) : contents;

        await this.connector.write(relativeRemotePath(remotePath), source, options);
    }

    public async uploadFile(localPath: string, remotePath: string, options: UploadFileOptions = {}): Promise<void> {
        const destination = relativeRemotePath(remotePath);
        const overwrite = options.overwrite ?? 'replace';

        if (overwrite !== 'replace' && overwrite !== 'fail') {
            throw new TypeError('overwrite must be replace or fail');
        }

        checkAbort(options.abortSignal ?? this.defaultSignal);

        if (overwrite === 'fail') {
            this.connector.validatePublicationOptions({...options, overwrite});
        }

        const source = await stat(localPath);

        if (!source.isFile()) {
            throw new NotSupportedError('Only a regular local file can be uploaded');
        }

        const transferOptions = {...options, totalBytes: options.totalBytes ?? source.size};

        if (overwrite === 'fail') {
            await this.connector.publishFile(destination, () => createReadStream(localPath), transferOptions);
        } else {
            await this.connector.write(destination, () => createReadStream(localPath), transferOptions);
        }
    }

    public async downloadFile(remotePath: string, localPath: string, options: DownloadFileOptions = {}): Promise<void> {
        const sourcePath = relativeRemotePath(remotePath);
        const destination = path.resolve(localPath);
        const overwrite = options.overwrite ?? 'fail';
        const maxBytes = resolveByteLimit(options.maxBytes === undefined ? this.defaultMaxBytes : options.maxBytes);
        const transferOptions = {...options, maxBytes};
        const signal = options.abortSignal ?? this.defaultSignal;

        if (overwrite !== 'replace' && overwrite !== 'fail') {
            throw new TypeError('overwrite must be replace or fail');
        }

        checkAbort(signal);

        const before = await this.connector.stat(sourcePath, transferOptions);

        if (before.type !== 'file') {
            throw new NotSupportedError('Only a regular remote file can be downloaded');
        }

        if (before.size !== undefined && before.size > maxBytes) {
            throw new ResourceLimitError('The download exceeds maxBytes');
        }

        const directory = await mkdtemp(path.join(path.dirname(destination), '.dockline-'));
        const staged = path.join(directory, 'download');
        let bytes = 0;

        try {
            const monitor = new Transform({
                transform(chunk, encoding, callback) {
                    bytes += Buffer.byteLength(chunk, encoding);

                    if (bytes > maxBytes) {
                        callback(new ResourceLimitError('The download exceeds maxBytes'));
                    } else {
                        callback(null, chunk);
                    }
                },
            });
            const source = await this.read(sourcePath, transferOptions);

            await pipeline(source, monitor, createWriteStream(staged, {flags: 'wx', mode: 0o600}), {signal});

            if (before.size !== undefined && bytes !== before.size) {
                throw new IntegrityError('The download length does not match the remote file');
            }

            checkAbort(signal);

            if (overwrite === 'replace') {
                await rename(staged, destination);
            } else {
                await link(staged, destination);
            }
        } catch (error) {
            const failure = signal?.aborted && error instanceof Error && error.name === 'AbortError' ?
                new OperationAbortedError() :
                error;

            await removeOwnedDownload(staged, directory).catch(cleanup => {
                throw new AggregateError([failure, cleanup], 'Download and staging cleanup failed');
            });

            throw failure;
        }

        await removeOwnedDownload(staged, directory);
    }

    public deleteFile(remotePath: string, options: ConnectorOperationOptions = {}) {
        return this.connector.deleteFile(relativeRemotePath(remotePath), options);
    }

    public createDirectory(remotePath: string, options: ConnectorOperationOptions = {}) {
        return this.connector.createDirectory(relativeRemotePath(remotePath), options);
    }

    public rename(from: string, to: string, options: RenameOptions) {
        return this.connector.renameFile(relativeRemotePath(from), relativeRemotePath(to), options);
    }

    public publishFile(remotePath: string, contents: TransferContents, options: PublishFileOptions = {}) {
        return this.connector.publishFile(relativeRemotePath(remotePath), contents, options);
    }

    public checksumDetails(remotePath: string, options: ChecksumDetailsOptions = {}) {
        return this.connector.checksumDetails(relativeRemotePath(remotePath), options);
    }

    public copyFile(from: string, to: string, options: CopyStrategyOptions = {}) {
        return this.connector.copyFileWithStrategy(relativeRemotePath(from), relativeRemotePath(to), options);
    }

    public walk(remotePath = '.', options: WalkOptions = {}) {
        return this.connector.walk(relativeRemotePath(remotePath, true), options);
    }

    public capabilities(options: Parameters<TransferAdapter['capabilities']>[0] = {}) {
        return this.connector.capabilities(options);
    }
}
