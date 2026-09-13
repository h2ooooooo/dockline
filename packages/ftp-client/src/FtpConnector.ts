import {resolveByteLimit, type FtpConnectorConfig, type TransferAdapter} from '@dockline/abstract';
import {Client, FTPError, type FileInfo as FtpFileInfo} from 'basic-ftp';
import type {
    StatEntry, FileContents, AdapterListOptions, WriteOptions,
    MiscellaneousOptions, CreateDirectoryOptions, CopyFileOptions, MoveFileOptions,
    PublicUrlOptions, TemporaryUrlOptions, ChecksumOptions, MimeTypeOptions,
} from '@flystorage/file-storage';
import {Readable, PassThrough} from 'node:stream';
import {finished} from 'node:stream/promises';
import {posix} from 'node:path';
import {
    type ConnectorOperationOptions, type ResolvedConnectorOperationOptions,
    type TransferContents, resolveOperationOptions, isTransientError,
    type ConnectionStateEvent, type ConnectionStage,
    classifyConnectionError, emitConnectionState, createTransferMonitor, CredentialProviderError,
    describeCapabilities, type ConnectorCapabilities,
    publishFile as publishTransfer, type PublishFileOptions, type PublicationResult,
    checksumDetails as calculateChecksum, type ChecksumDetailsOptions, type ChecksumResult,
    copyFileWithStrategy as copyTransfer, type CopyStrategyOptions, type CopyResult,
    walk as walkEntries, type WalkOptions,
} from '@dockline/abstract';
import {
    ConnectorError, AuthError, NotFoundError, PermissionError, NotSupportedError,
    OperationAbortedError, OperationTimeoutError, ConnectionClosedError,
} from './errors.js';
import {resolveFilenameEncoding, validateFilename, type FtpFilenameEncoding} from './filename-encoding.js';

export type {FtpConnectorConfig} from '@dockline/abstract';

type FtpOptions<T = MiscellaneousOptions> = T & ConnectorOperationOptions;

/** A factory explicitly permits replay of an overwriting upload with a fresh stream. */

export type FtpUploadSource = TransferContents;

/** One queue wait or one attempt; an external abort is never retried. */
class OperationContext {
    private timer?: ReturnType<typeof setTimeout>;

    readonly cancellation = new AbortController();

    stage: ConnectionStage = 'connect';

    attempt = 1;

    private rejectInterrupted!: (error: Error) => void;

    private readonly interrupted: Promise<never>;

    private readonly onAbort = () => this.interrupt(new OperationAbortedError('FTP operation aborted'));

    error?: Error;

    onInterrupt?: () => void;

    constructor(readonly options: ResolvedConnectorOperationOptions) {
        this.interrupted = new Promise<never>((_resolve, reject) => {
            this.rejectInterrupted = reject;
        });
        // An abort can happen before the first wait attaches its handler.
        void this.interrupted.catch(() => {
        });

        if (options.abortSignal?.aborted) {
            this.onAbort();
        } else {
            options.abortSignal?.addEventListener('abort', this.onAbort, {once: true});

            if (options.timeoutMs > 0) {
                this.timer = setTimeout(() => this.interrupt(new OperationTimeoutError('FTP operation timed out')), options.timeoutMs);
            }
        }
    }

    private interrupt(error: Error): void {
        if (this.error) {
            return;
        }

        this.error = error;
        this.cancellation.abort();
        this.onInterrupt?.();
        this.rejectInterrupted(error);
    }

    check(): void {
        if (this.error) {
            throw this.error;
        }
    }

    abort(): void {
        this.onAbort();
    }

    wait<T>(value: Promise<T>): Promise<T> {
        return Promise.race([value, this.interrupted]);
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }

        this.options.abortSignal?.removeEventListener('abort', this.onAbort);
    }
}

export class FtpConnector implements TransferAdapter {
    private client: Client;

    private needsNewClient = false;

    private connected = false;

    private hasConnected = false;

    private connectionPromise?: Promise<void>;

    private generation = 0;

    private disconnectGeneration = 0;

    private queue: Promise<void> = Promise.resolve();

    private cancelActive?: () => void;

    private readonly filenameEncoding: FtpFilenameEncoding;

    private keepaliveTimer?: ReturnType<typeof setTimeout>;

    private pendingOperations = 0;

    private missedKeepalives = 0;

    private lastAttempt = 0;

    private currentState: ConnectionStateEvent['state'] = 'disconnected';

    #providerPassword?: string;

    constructor(private readonly config: FtpConnectorConfig) {
        resolveOperationOptions(config);
        this.filenameEncoding = resolveFilenameEncoding(config.filenameEncoding);
        validateFilename(config.initialPath ?? '', this.filenameEncoding);

        if (config.keepalive) {
            const {intervalMs, maxMissed = 2} = config.keepalive;

            if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) {
                throw new RangeError('keepalive.intervalMs must be an integer from 1 to 2147483647');
            }

            if (!Number.isSafeInteger(maxMissed) || maxMissed < 1) {
                throw new RangeError('keepalive.maxMissed must be a positive safe integer');
            }
        }

        // The connector owns per-attempt deadlines, including per-call overrides.
        this.client = this.createClient();
    }

    private createClient(): Client {
        const client = new Client(0);

        // ASCII validation uses latin1 decoding so incoming high bits cannot be silently discarded.
        client.ftp.encoding = this.filenameEncoding === 'utf8' ? 'utf8' : 'latin1';

        return client;
    }

    public get connectionState(): ConnectionStateEvent['state'] {
        return this.currentState;
    }

    private transition(state: ConnectionStateEvent['state'], error?: ConnectorError): void {
        this.currentState = state;
        emitConnectionState(this.config.onConnectionState, {
            state,
            protocol: 'ftp',
            attempt: this.lastAttempt,
            ...(error ? {error} : {}),
        });
    }

    private clearKeepalive(): void {
        clearTimeout(this.keepaliveTimer);
        this.keepaliveTimer = undefined;
    }

    private scheduleKeepalive(): void {
        this.clearKeepalive();

        if (!this.config.keepalive || !this.connected || this.pendingOperations !== 0) {
            return;
        }

        this.keepaliveTimer = setTimeout(() => {
            this.keepaliveTimer = undefined;
            void this.probeKeepalive();
        }, this.config.keepalive.intervalMs);
        this.keepaliveTimer.unref();
    }

    private async probeKeepalive(): Promise<void> {
        if (!this.connected || this.pendingOperations !== 0) {
            return;
        }

        const generation = this.generation;

        try {
            await this.execute({autoReconnect: false, maxTransientRetries: 0}, false, async (_context, client) => {
                await client.send('NOOP');
            }, false, true);
            this.missedKeepalives = 0;
        } catch (error) {
            if (generation !== this.generation || !this.connected) {
                return;
            }

            this.missedKeepalives++;

            if (this.missedKeepalives >= (this.config.keepalive?.maxMissed ?? 2)) {
                this.invalidate();
                this.transition('failed', this.wrapError(error) as ConnectorError);
            }
        } finally {
            this.scheduleKeepalive();
        }
    }

    private invalidate(): void {
        this.clearKeepalive();
        this.generation++;
        this.connected = false;
        this.connectionPromise = undefined;
        this.client.close();
        this.needsNewClient = true;
        this.transition('disconnected');
    }

    async disconnect(): Promise<void> {
        this.disconnectGeneration++;
        this.cancelActive?.();
        this.invalidate();
        // Explicit disconnect permits a later intentional reuse of the connector.
        this.hasConnected = false;
        this.#providerPassword = undefined;
    }

    async connect(options: ConnectorOperationOptions = {}): Promise<void> {
        await this.execute(options, true, async () => {
        }, true);
    }

    private async ensureConnected(
        options: ResolvedConnectorOperationOptions,
        explicit = false,
        context: OperationContext,
    ): Promise<void> {
        if (this.connected && !this.client.closed) {
            return;
        }

        if (this.hasConnected && !options.autoReconnect && !explicit) {
            throw new ConnectionClosedError('FTP connection closed; reconnect explicitly or enable autoReconnect');
        }

        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        if (this.config.passive === false) {
            throw new NotSupportedError('Active FTP is not supported. Select passive mode.');
        }

        if (this.needsNewClient || (this.hasConnected && this.client.closed)) {
            this.client = this.createClient();
            this.needsNewClient = false;
        }

        const client = this.client;
        const generation = this.generation;

        this.lastAttempt = context.attempt;
        this.transition(this.hasConnected ? 'reconnecting' : 'connecting');

        const connection = (async () => {
            try {
                let user = this.config.user;
                let password = this.config.password;

                this.#providerPassword = undefined;

                if (this.config.credentialProvider) {
                    context.stage = 'credentials';

                    let credentials;

                    try {
                        credentials = await context.wait(Promise.resolve(this.config.credentialProvider({
                            siteId: this.config.siteId,
                            host: this.config.host,
                            port: this.config.port,
                            protocol: 'ftp',
                            purpose: this.hasConnected ? 'reconnect' : 'connect',
                            attempt: context.attempt,
                            abortSignal: context.cancellation.signal,
                        })));
                    } catch {
                        context.check();

                        throw new CredentialProviderError('FTP credential provider failed');
                    }

                    context.check();

                    if (credentials?.type !== 'password' || typeof credentials.password !== 'string') {
                        throw new CredentialProviderError('FTP requires password credentials');
                    }

                    if (credentials.username !== undefined && typeof credentials.username !== 'string') {
                        throw new CredentialProviderError('FTP credential username must be a string');
                    }

                    user = credentials.username ?? user;
                    password = credentials.password;
                    this.#providerPassword = password;
                }

                validateFilename(user, this.filenameEncoding);
                validateFilename(password, this.filenameEncoding);
                context.stage = 'connect';

                if (this.config.secure === 'implicit') {
                    await client.connectImplicitTLS(this.config.host, this.config.port, {...this.config.secureOptions});
                } else {
                    await client.connect(this.config.host, this.config.port);
                }

                context.check();

                if (this.config.secure === true) {
                    context.stage = 'trust';
                    await client.useTLS({host: this.config.host, ...this.config.secureOptions});
                    context.check();
                }

                context.stage = 'authenticate';

                if (this.filenameEncoding === 'utf8') {
                    await client.sendIgnoringError('OPTS UTF8 ON');
                    context.check();
                }

                await client.login(user, password);
                context.check();
                context.stage = 'ready';
                await client.useDefaultSettings();
                context.check();

                if (this.filenameEncoding !== 'utf8') {
                    try {
                        await client.send('OPTS UTF8 OFF');
                    } catch {
                        context.check();

                        throw new NotSupportedError('FTP server did not confirm legacy filename encoding (OPTS UTF8 OFF)');
                    }

                    context.check();
                }

                if (this.config.initialPath) {
                    context.stage = 'directory';
                    await client.cd(this.config.initialPath);
                    context.check();
                }

                if (generation !== this.generation) {
                    throw new OperationAbortedError('FTP connection interrupted');
                }

                this.connected = true;
                this.hasConnected = true;
                this.missedKeepalives = 0;
                this.transition('ready');
            } catch (error) {
                const mapped = classifyConnectionError(this.wrapError(error), context.stage);

                if (generation === this.generation) {
                    this.invalidate();
                }

                throw mapped;
            }
        })();

        this.connectionPromise = connection;

        try {
            await connection;
        } finally {
            if (this.connectionPromise === connection) {
                this.connectionPromise = undefined;
            }
        }
    }

    private async execute<T>(
        supplied: ConnectorOperationOptions & {
            timeout?: number;
        },
        replaySafe: boolean,
        operation: (context: OperationContext, client: Client) => Promise<T>,
        explicitConnect = false,
        background = false,
    ): Promise<T> {
        const options = resolveOperationOptions(this.config, {
            ...supplied,
            timeoutMs: supplied.timeoutMs ?? supplied.timeout,
        });

        this.pendingOperations++;
        this.clearKeepalive();

        const disconnectGeneration = this.disconnectGeneration;
        const queueContext = new OperationContext(options);
        let release!: () => void;
        const previous = this.queue;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });

        this.queue = previous.then(() => gate);

        try {
            queueContext.check();
            await queueContext.wait(previous);
            queueContext.check();

            if (disconnectGeneration !== this.disconnectGeneration) {
                throw new OperationAbortedError('FTP operation cancelled by disconnect');
            }

            queueContext.dispose();

            for (let attempt = 0; ; attempt++) {
                const context = new OperationContext(options);

                context.attempt = attempt + 1;

                const initiallyUnconnected = !this.hasConnected;
                let started = false;
                const cancellation = new AbortController();
                // disconnect() must interrupt even when a controlled dependency promise hangs.
                const disconnected = new Promise<never>((_resolve, reject) => {
                    cancellation.signal.addEventListener('abort', () => reject(new OperationAbortedError('FTP operation cancelled by disconnect')), {once: true});
                });

                void disconnected.catch(() => {
                });
                this.cancelActive = () => {
                    cancellation.abort();
                    context.abort();
                };

                const generation = this.generation;

                context.onInterrupt = () => {
                    if (generation === this.generation) {
                        this.invalidate();
                    }
                };

                try {
                    context.check();

                    const connection = this.ensureConnected(options, explicitConnect, context);

                    await context.wait(Promise.race([connection, disconnected]));
                    context.check();
                    started = true;

                    return await context.wait(Promise.race([operation(context, this.client), disconnected]));
                } catch (error) {
                    const interrupted = options.abortSignal?.aborted || cancellation.signal.aborted;
                    const mayRetry = started ?
                        replaySafe && options.autoReconnect :
                        initiallyUnconnected || options.autoReconnect || explicitConnect;

                    if (
                        !interrupted &&
                        context.stage !== 'credentials' &&
                        mayRetry &&
                        attempt < options.maxTransientRetries &&
                        isTransientError(error)
                    ) {
                        this.invalidate();
                        continue;
                    }

                    const mapped = started ? this.wrapError(error) :
                        classifyConnectionError(this.wrapError(error), context.stage);

                    if (!started && !background) {
                        this.transition('failed', mapped as ConnectorError);
                    }

                    throw mapped;
                } finally {
                    context.dispose();
                    this.cancelActive = undefined;
                }
            }
        } finally {
            queueContext.dispose();
            release();
            this.pendingOperations--;
            this.scheduleKeepalive();
        }
    }

    private wrapError(error: unknown): Error {
        if (error instanceof ConnectorError) {
            return error;
        }

        const rawMessage = error instanceof Error ? error.message : 'Unknown transport error';
        let message = rawMessage;

        for (const secret of [this.config.password, this.#providerPassword]) {
            if (secret) {
                message = message.split(secret).join('[REDACTED]');
            }
        }

        const rawCode = error && typeof error === 'object' ? (error as {
            code?: unknown;
        }).code : undefined;
        const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? rawCode : undefined;

        if (error instanceof FTPError) {
            if (error.code === 530 || (error.code === 331 && message.toLowerCase().includes('auth'))) {
                return new AuthError(message);
            }

            if (error.code === 532 || (error.code === 550 && message.toLowerCase().includes('permission'))) {
                return new PermissionError(message);
            }
        }

        // Preserve only the non-secret status needed to classify a transient failure.
        return new ConnectorError(message, undefined, code);
    }

    async write(path: string, contents: FtpUploadSource, options: FtpOptions<WriteOptions>): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        const factory = typeof contents === 'function' ? contents : undefined;
        const used = new WeakSet<Readable>();

        await this.execute(options, Boolean(factory), async (context, client) => {
            const source = factory ? await factory() : contents as Readable;

            if (!(source instanceof Readable)) {
                throw new ConnectorError('FTP upload factory must return a Readable');
            }

            if (used.has(source) || source.destroyed || source.readableEnded || (factory && source.readableDidRead)) {
                if (factory) {
                    source.destroy();
                }

                throw new ConnectorError('FTP upload retry requires a fresh, unread stream');
            }

            used.add(source);

            if (context.error) {
                source.destroy();
                context.check();
            }

            const monitor = createTransferMonitor({
                ...this.config,
                ...options,
                maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
            }, 'upload', context.attempt, path);
            const abort = context.onInterrupt;
            const sourceError = (error: Error) => monitor.stream.destroy(error);

            source.on('error', sourceError);
            monitor.stream.on('error', () => {});

            context.onInterrupt = () => {
                source.destroy();
                monitor.stream.destroy(context.error);
                abort?.();
            };

            try {
                context.check();
                source.pipe(monitor.stream);
                await client.uploadFrom(monitor.stream, path);
                monitor.complete();
            } catch (error) {
                const failure = monitor.stream.errored ?? error;

                source.destroy();
                monitor.fail(failure);
                throw failure;
            } finally {
                source.unpipe(monitor.stream);
                source.removeListener('error', sourceError);
                monitor.stream.destroy();
                monitor.dispose();

                if (context.error) {
                    source.destroy();
                }
            }
        });
    }

    async read(path: string, options: FtpOptions): Promise<FileContents> {
        validateFilename(path, this.filenameEncoding);

        let resolveResult!: (value: Readable) => void;
        let rejectResult!: (error: unknown) => void;
        let output: PassThrough | undefined;
        let resultReturned = false;
        const result = new Promise<Readable>((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        });

        void this.execute(options, false, async (context, client) => {
            const generation = this.generation;

            output = new PassThrough();

            const stream = output;
            const monitor = createTransferMonitor({
                ...this.config,
                ...options,
                maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
            }, 'download', context.attempt, path);
            const transfer = monitor.stream;

            stream.on('error', () => {
            });
            transfer.on('error', error => stream.destroy(this.wrapError(error)));
            transfer.pipe(stream, {end: false});

            const abort = context.onInterrupt;

            context.onInterrupt = () => {
                transfer.destroy(context.error);
                stream.destroy(context.error);
                abort?.();
            };

            const consumed = new Promise<void>((resolve, reject) => {
                stream.once('end', resolve);
                stream.once('error', reject);
                stream.once('close', () => {
                    if (!stream.readableEnded) {
                        transfer.destroy(stream.errored ?? new OperationAbortedError('FTP read cancelled before completion'));

                        if (generation === this.generation) {
                            this.invalidate();
                        }

                        reject(stream.errored ?? new OperationAbortedError('FTP read cancelled before completion'));
                    }
                });
            });
            const drained = finished(transfer);

            void drained.catch(() => {});
            context.check();

            const download = client.downloadTo(transfer, path).then(async () => {
                await drained;
                // Data EOF alone is not a completed FTP transfer.
                stream.end();
            }).catch(error => {
                const mapped = this.wrapError(error);

                transfer.destroy();
                stream.destroy(mapped);
                throw mapped;
            });

            resolveResult(stream);
            resultReturned = true;

            try {
                await Promise.all([download, consumed]);
                monitor.complete();
            } catch (error) {
                monitor.fail(error);
                throw error;
            } finally {
                monitor.dispose();
                transfer.destroy();
            }
        }).catch(error => {
            output?.destroy(this.wrapError(error));

            if (!resultReturned) {
                rejectResult(error);
            }
        });

        return result;
    }

    async deleteFile(path: string, options: FtpOptions): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        await this.execute(options, false, async (_context, client) => {
            await client.remove(path);
        });
    }

    async createDirectory(path: string, options: FtpOptions<CreateDirectoryOptions>): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        await this.execute(options, false, async (context, client) => {
            const generation = this.generation;
            const original = await client.pwd();

            validateFilename(original, this.filenameEncoding);

            context.check();

            let creationError: unknown;
            let restorationError: unknown;
            let failed = false;
            let restorationFailed = false;

            try {
                await client.ensureDir(path);
            } catch (error) {
                creationError = error;
                failed = true;
            } finally {
                if (!context.error && generation === this.generation) {
                    try {
                        await client.cd(original);
                    } catch (restoreError) {
                        this.invalidate();
                        restorationError = restoreError;
                        restorationFailed = true;
                    }
                }
            }

            if (failed) {
                throw creationError;
            }

            if (restorationFailed) {
                throw restorationError;
            }
        });
    }

    public async createDirectoryExclusive(path: string, options: ConnectorOperationOptions = {}): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        await this.execute(options, false, async (_context, client) => {
            await client.send(`MKD ${path}`);
        });
    }

    public async removeEmptyDirectory(path: string, options: ConnectorOperationOptions = {}): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        await this.execute(options, false, async (_context, client) => {
            await client.send(`RMD ${path}`);
        });
    }

    public async renameFile(
        from: string,
        to: string,
        options: ConnectorOperationOptions & {overwrite: 'fail' | 'replace'; requireAtomicRename?: boolean},
    ): Promise<{atomic: boolean}> {
        validateFilename(from, this.filenameEncoding);
        validateFilename(to, this.filenameEncoding);

        if (options.overwrite !== 'replace' || options.requireAtomicRename) {
            throw new NotSupportedError('FTP cannot guarantee no-clobber or atomic rename; explicit replacement is required');
        }

        await this.moveFile(from, to, options);

        return {atomic: false};
    }

    public async serverFeatures(options: ConnectorOperationOptions = {}): Promise<readonly string[]> {
        return this.execute(options, true, async (_context, client) => {
            const features = await client.features();

            return Object.freeze([...features].map(([name, value]) => value ? `${name} ${value}` : name));
        });
    }

    public async serverChecksum(
        path: string,
        algorithm: 'sha256' | 'sha512',
        options: ConnectorOperationOptions = {},
    ): Promise<string> {
        validateFilename(path, this.filenameEncoding);

        if (algorithm !== 'sha256' && algorithm !== 'sha512') {
            throw new NotSupportedError('FTP server checksum supports SHA-256 and SHA-512 only');
        }

        return this.execute(options, true, async (context, client) => {
            const features = await client.features();
            const advertised = features.get('HASH');
            const selected = algorithm === 'sha256' ? 'SHA-256' : 'SHA-512';
            const supported = advertised?.split(';').map(value => value.trim().replace(/\*$/, '')) ?? [];

            if (!supported.includes(selected)) {
                throw new NotSupportedError(`FTP server does not advertise HASH ${selected}`);
            }

            context.check();
            await client.send(`OPTS HASH ${selected}`);
            context.check();

            const response = await client.send(`HASH ${path}`);
            const match = /^213 (?:((?:SHA-256|SHA-512)) (0)-([0-9]+) ([a-f0-9]+)(?: .*)?|([a-f0-9]+))$/i.exec(response.message);
            const digest = match?.[4] ?? match?.[5];
            const length = algorithm === 'sha256' ? 64 : 128;

            if (
                response.code !== 213 ||
                !digest ||
                digest.length !== length ||
                (match?.[1] !== undefined &&
                    match[1].toUpperCase() !== selected)
            ) {
                throw new ConnectorError('FTP server returned an invalid or mismatched HASH response');
            }

            return digest.toLowerCase();
        });
    }

    async deleteDirectory(path: string, options: FtpOptions): Promise<void> {
        validateFilename(path, this.filenameEncoding);

        await this.execute(options, false, async (_context, client) => {
            await client.removeDir(path);
        });
    }

    async fileExists(path: string, options: FtpOptions): Promise<boolean> {
        try {
            return (await this.stat(path, options)).type === 'file';
        } catch (error) {
            if (error instanceof NotFoundError) {
                return false;
            }

            throw error;
        }
    }

    async directoryExists(path: string, options: FtpOptions): Promise<boolean> {
        try {
            return (await this.stat(path, options)).type === 'directory';
        } catch (error) {
            if (error instanceof NotFoundError) {
                return false;
            }

            throw error;
        }
    }

    private entryInfo(entry: FtpFileInfo, path: string): StatEntry {
        if (entry.isDirectory && !entry.isSymbolicLink) {
            return {
                type: 'directory',
                path,
                isFile: false,
                isDirectory: true,
                lastModifiedMs: entry.modifiedAt?.getTime(),
            };
        }

        return {
            type: 'file',
            path,
            isFile: true,
            isDirectory: false,
            size: entry.size,
            lastModifiedMs: entry.modifiedAt?.getTime(),
            isSymbolicLink: entry.isSymbolicLink,
            isUnsupported: !entry.isFile,
        } as StatEntry;
    }

    async *list(path: string, options: FtpOptions<AdapterListOptions>): AsyncGenerator<StatEntry> {
        validateFilename(path, this.filenameEncoding);

        const entries = await this.execute(options, true, async (_context, client) => client.list(path));

        for (const entry of entries) {
            validateFilename(entry.name, this.filenameEncoding);

            const entryPath = path ? `${path.replace(/\/$/, '')}/${entry.name}` : entry.name;

            yield this.entryInfo(entry, entryPath);

            if (options.deep && entry.isDirectory && !entry.isSymbolicLink) {
                yield* this.list(entryPath, options);
            }
        }
    }

    async moveFile(from: string, to: string, options: FtpOptions<MoveFileOptions>): Promise<void> {
        validateFilename(from, this.filenameEncoding);
        validateFilename(to, this.filenameEncoding);

        await this.execute(options, false, async (_context, client) => {
            await client.rename(from, to);
        });
    }

    public async capabilities(
        options: ConnectorOperationOptions & {negotiate?: boolean} = {},
    ): Promise<ConnectorCapabilities> {
        return describeCapabilities('ftp', options.negotiate ? await this.serverFeatures(options) : undefined);
    }

    public async publishFile(
        destination: string,
        contents: FtpUploadSource,
        options: PublishFileOptions = {},
    ): Promise<PublicationResult> {
        this.validatePublicationOptions(options);
        validateFilename(destination, this.filenameEncoding);

        return publishTransfer(this, destination, contents, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public validatePublicationOptions(options: PublishFileOptions): void {
        resolveOperationOptions(this.config, options);
        resolveByteLimit(options.verify?.maxBytes);

        if (options.overwrite !== 'replace' || options.requireAtomicRename) {
            throw new NotSupportedError('FTP publication requires overwrite: replace and cannot guarantee atomic rename');
        }
    }

    public async copyFileWithStrategy(
        from: string,
        to: string,
        options: CopyStrategyOptions = {},
    ): Promise<CopyResult> {
        this.validatePublicationOptions(options);
        validateFilename(from, this.filenameEncoding);
        validateFilename(to, this.filenameEncoding);

        return copyTransfer(this, from, to, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    async copyFile(
        from: string,
        to: string,
        options: FtpOptions<CopyFileOptions> & CopyStrategyOptions,
    ): Promise<void> {
        await this.copyFileWithStrategy(from, to, options);
    }

    public async checksumDetails(path: string, options: ChecksumDetailsOptions = {}): Promise<ChecksumResult> {
        validateFilename(path, this.filenameEncoding);

        return calculateChecksum(this, path, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public walk(path: string, options: WalkOptions = {}): ReturnType<typeof walkEntries> {
        validateFilename(path, this.filenameEncoding);

        return walkEntries(this, path, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    async stat(path: string, options: FtpOptions): Promise<StatEntry> {
        validateFilename(path, this.filenameEncoding);

        return this.execute(options, true, async (_context, client) => {
            const normalized = posix.normalize(path || '.');

            if (normalized === '.' || normalized === '/') {
                // A successful directory listing validates root/current even when it is empty.
                await client.list(normalized);

                return {
                    type: 'directory',
                    path,
                    isFile: false,
                    isDirectory: true,
                };
            }

            const clean = normalized.replace(/\/$/, '');
            const entries = await client.list(posix.dirname(clean));

            for (const item of entries) {
                validateFilename(item.name, this.filenameEncoding);
            }

            const entry = entries.find(item => item.name === posix.basename(clean));

            if (!entry || (path.endsWith('/') && !entry.isDirectory && !entry.isSymbolicLink)) {
                throw new NotFoundError(`File not found: ${path}`);
            }

            if (entry.isSymbolicLink) {
                throw new NotSupportedError(`Symbolic link cannot be followed: ${path}`);
            }

            if (!entry.isDirectory && !entry.isFile) {
                throw new NotSupportedError(`Special file cannot be followed: ${path}`);
            }

            return this.entryInfo(entry, path);
        });
    }

    async changeVisibility(_path: string, _visibility: string, _options: FtpOptions): Promise<void> {
        throw new NotSupportedError('FTP visibility not supported');
    }

    async visibility(_path: string, _options: FtpOptions): Promise<string> {
        throw new NotSupportedError('FTP visibility not supported');
    }

    async publicUrl(_path: string, _options: FtpOptions<PublicUrlOptions>): Promise<string> {
        throw new NotSupportedError('FTP publicUrl not supported');
    }

    async temporaryUrl(_path: string, _options: FtpOptions<TemporaryUrlOptions>): Promise<string> {
        throw new NotSupportedError('FTP temporaryUrl not supported');
    }

    async checksum(path: string, options: FtpOptions<ChecksumOptions> & ChecksumDetailsOptions): Promise<string> {
        const encoding = options.encoding ?? 'hex';

        if (encoding !== 'hex' && encoding !== 'base64' && encoding !== 'base64url') {
            throw new NotSupportedError('Checksum encoding supports hex, base64 or base64url');
        }

        const result = await this.checksumDetails(path, {...options, algorithm: options.algorithm ?? options.algo});

        return Buffer.from(result.digest, 'hex').toString(encoding);
    }

    async mimeType(_path: string, _options: FtpOptions<MimeTypeOptions>): Promise<string> {
        throw new NotSupportedError('FTP mimeType not supported');
    }

    async lastModified(path: string, options: FtpOptions): Promise<number> {
        validateFilename(path, this.filenameEncoding);

        return this.execute(options, true, async (_context, client) => (await client.lastMod(path)).getTime());
    }

    async fileSize(path: string, options: FtpOptions): Promise<number> {
        const entry = await this.stat(path, options);

        if (entry.type !== 'file' || entry.size === undefined) {
            throw new ConnectorError('File size not available');
        }

        return entry.size;
    }

    public static _wrapErrorForTest(error: unknown, password?: string): unknown {
        return new FtpConnector({password: password ?? ''} as FtpConnectorConfig).wrapError(error);
    }
}
