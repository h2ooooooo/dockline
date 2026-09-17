import {resolveByteLimit, type SftpConnectorConfig, type SftpHostKeyChallenge, type SftpKeyboardInteractiveChallenge, type TransferAdapter} from '@jalsoedesign/dockline-abstract';
import SftpClient from 'ssh2-sftp-client';
import type {KeyboardInteractiveAuthMethod} from 'ssh2';
import type {
    FileInfo, DirectoryInfo, StatEntry, FileContents,
    AdapterListOptions, WriteOptions, MiscellaneousOptions, CreateDirectoryOptions,
    CopyFileOptions, MoveFileOptions, PublicUrlOptions, TemporaryUrlOptions,
    ChecksumOptions, MimeTypeOptions,
} from '@flystorage/file-storage';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareSshPrivateKey} from './PrivateKey.js';
import {
    ConnectorError, AuthError, NotFoundError, PermissionError, NotSupportedError,
    HostTrustError, OperationAbortedError, OperationTimeoutError, ConnectionClosedError,
    resolveOperationOptions, isTransientError, classifyConnectionError, emitConnectionState,
    createTransferMonitor, CredentialProviderError, describeCapabilities,
    publishFile as publishTransfer, checksumDetails as calculateChecksum,
    copyFileWithStrategy, walk as walkDirectory,
    type PublishFileOptions, type ChecksumDetailsOptions, type CopyStrategyOptions, type CopyResult, type WalkOptions,
    type ConnectionStateEvent, type ConnectionStage,
    type ConnectorOperationOptions, type ResolvedConnectorOperationOptions, type TransferContents,
} from '@jalsoedesign/dockline-abstract';

export type {
    SftpConnectorConfig, SftpHostKeyChallenge, SftpTrustPolicy, SftpHostVerifier,
    SftpKeyboardInteractive, SftpKeyboardInteractiveChallenge,
} from '@jalsoedesign/dockline-abstract';

type OperationOptions<T> = T & ConnectorOperationOptions;
interface OperationAttempt {
    number: number;
    deadline?: number;
    error?: Error;
    cancel?: (error: Error) => void;
}

export class SftpConnector implements TransferAdapter {
    private client: SftpClient;

    private clientUsed = false;

    private connected = false;

    private connectionLost = false;

    private connecting?: Promise<void>;

    private disconnectGeneration = 0;

    private previousFingerprint?: string;

    private everConnected = false;

    private state: ConnectionStateEvent['state'] = 'disconnected';

    private readonly secrets = new Set<string>();

    private readonly active = new Set<(error: Error) => void>();

    constructor(private readonly config: SftpConnectorConfig) {
        resolveOperationOptions(config);

        if (
            config.keyboardInteractive !== undefined &&
            typeof config.keyboardInteractive !== 'string' &&
            typeof config.keyboardInteractive !== 'function'
        ) {
            throw new AuthError('keyboardInteractive must be a string or callback');
        }

        if (config.agentForward) {
            throw new NotSupportedError('SSH agent forwarding is not supported');
        }

        if (config.agent !== undefined && (typeof config.agent !== 'string' || config.agent.length === 0)) {
            throw new AuthError('SSH agent must be an explicit non-empty socket path or pageant');
        }

        if (config.filenameEncoding && !/^utf-?8$/i.test(config.filenameEncoding.charset)) {
            throw new NotSupportedError('SFTP only supports UTF-8 filename encoding');
        }

        if (
            config.keepalive &&
            (
                !Number.isSafeInteger(config.keepalive.intervalMs) ||
                config.keepalive.intervalMs < 0 ||
                config.keepalive.intervalMs > 2147483647 ||
                !Number.isSafeInteger(config.keepalive.maxMissed ?? 3) ||
                (config.keepalive.maxMissed ?? 3) < 1
            )
        ) {
            throw new ConnectorError('Keepalive requires a non-negative intervalMs and positive maxMissed');
        }

        this.client = this.createClient();
    }

    private emitState(state: ConnectionStateEvent['state'], attempt = 1, error?: Error): void {
        if (state === this.state && state === 'disconnected') {
            return;
        }

        this.state = state;
        emitConnectionState(this.config.onConnectionState, {
            state,
            protocol: 'sftp',
            attempt,
            error: error ? classifyConnectionError(error, 'connect') : undefined,
        });
    }

    private createClient(): SftpClient {
        const client = new SftpClient('dockline', {
            error: (error) => this.connectionFailed(client, this.wrapError(error)),
            end: () => this.connectionFailed(client, new ConnectionClosedError('SFTP connection ended')),
            close: () => this.connectionFailed(client, new ConnectionClosedError('SFTP connection closed')),
        });

        return client;
    }

    private connectionFailed(client: SftpClient, error: Error): void {
        if (client !== this.client) {
            return;
        }

        if (this.connected) {
            this.connectionLost = true;
            this.emitState('disconnected', 1, error);
        }

        this.connected = false;

        for (const fail of [...this.active]) {
            fail(error);
        }
    }

    private invalidate(error: Error, client: SftpClient = this.client): void {
        if (client !== this.client) {
            return;
        }

        this.connectionLost = true;
        this.connectionFailed(client, error);
        void this.closeClient(client);
    }

    private closeClient(client: SftpClient): Promise<unknown> {
        const ending = client.end().catch(() => {});
        // Upstream end() skips the underlying SSH socket before SFTP is established.
        // Destroy it as well so cancelled host-trust prompts/handshakes cannot linger.
        const transport = client as SftpClient & {client?: {destroy(): void}};

        transport.client?.destroy();

        return ending;
    }

    async connect(options: ConnectorOperationOptions = {}): Promise<void> {
        const resolved = resolveOperationOptions(this.config, options);

        this.checkAborted(resolved);

        if (this.connected) {
            return;
        }

        const sharedAttempt = this.connecting;

        if (!sharedAttempt) {
            const connecting = this.establishConnection(resolved);

            this.connecting = connecting;
            void connecting.finally(() => {
                if (this.connecting === connecting) {
                    this.connecting = undefined;
                }
            }).catch(() => {});
        }

        if (sharedAttempt) {
            await this.waitForConnection(sharedAttempt, resolved);
        } else {
            await this.connecting;
        }

        this.checkAborted(resolved);
    }

    private async waitForConnection(
        connection: Promise<void>,
        options: ResolvedConnectorOperationOptions,
    ): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort = () => {};

        try {
            await new Promise<void>((resolve, reject) => {
                abort = () => reject(new OperationAbortedError('Waiting for the SFTP connection was aborted'));
                options.abortSignal?.addEventListener('abort', abort, {once: true});

                if (options.timeoutMs > 0) {
                    timer = setTimeout(() => reject(new OperationTimeoutError('Waiting for the SFTP connection timed out')), options.timeoutMs);
                }

                void connection.then(resolve, reject);
            });
        } finally {
            options.abortSignal?.removeEventListener('abort', abort);

            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private async establishConnection(options: ResolvedConnectorOperationOptions): Promise<void> {
        if (
            this.config.requireTrustPolicy &&
            (typeof this.config.hasTrustPolicy !== 'function' ||
                typeof this.config.acceptTrustPolicy !== 'function')
        ) {
            throw new HostTrustError('requireTrustPolicy needs both hasTrustPolicy and acceptTrustPolicy callbacks');
        }

        const generation = this.disconnectGeneration;
        const purpose = this.everConnected ? 'reconnect' : 'connect';

        for (let attempt = 0; ; attempt++) {
            this.checkAborted(options);

            if (this.clientUsed) {
                this.client = this.createClient();
            }

            this.clientUsed = true;

            const client = this.client;

            this.emitState(purpose === 'reconnect' || attempt > 0 ? 'reconnecting' : 'connecting', attempt + 1);

            let trustError: HostTrustError | undefined;
            let authenticationError: AuthError | undefined;
            let prompted = false;
            let stage: ConnectionStage = 'credentials';
            let accepting = true;
            const trustAbort = new AbortController();

            try {
                await this.withAttempt(async () => {
                    const authentication = await this.authenticationForAttempt(purpose, attempt + 1, trustAbort.signal);

                    stage = 'connect';

                    this.checkAborted(options);

                    if (!accepting || generation !== this.disconnectGeneration) {
                        throw new ConnectionClosedError('SFTP connection attempt was cancelled');
                    }

                    await client.connect({
                        host: this.config.host,
                        port: this.config.port,
                        ...authentication,
                        agentForward: false,
                        keepaliveInterval: this.config.keepalive?.intervalMs ?? 0,
                        keepaliveCountMax: this.config.keepalive?.maxMissed ?? 3,
                        authHandler: this.config.keyboardInteractive === undefined ?
                            authentication.authHandler : [
                                {
                                    type: 'keyboard-interactive',
                                    username: authentication.username!,
                                    prompt: (name, instructions, language, prompts, finish) => {
                                        prompted = true;
                                        stage = 'authenticate';

                                        void this.answerChallenges({
                                            name,
                                            instructions,
                                            language,
                                            prompts: prompts.map((prompt) => ({
                                                prompt: prompt.prompt,
                                                echo: prompt.echo ?? false,
                                            })),
                                            abortSignal: trustAbort.signal,
                                        }).then((answers) => {
                                            if (accepting && !trustAbort.signal.aborted && client === this.client) {
                                                finish(answers);
                                            }
                                        }).catch(() => {
                                            authenticationError = new AuthError('Keyboard-interactive authentication failed; check the callback and answer count');
                                            accepting = false;
                                            trustAbort.abort();
                                            this.invalidate(authenticationError!, client);
                                        });
                                    },
                                } as KeyboardInteractiveAuthMethod,
                            ],
                        readyTimeout: this.config.readyTimeout ?? (options.timeoutMs || 30000),
                        hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
                            stage = 'trust';

                            void this.verifyHostKey(key, trustAbort.signal).then((accepted) => {
                                if (!accepted) {
                                    trustError = new HostTrustError('SFTP host key was not accepted by the trust policy');
                                }

                                if (accepted) {
                                    stage = 'authenticate';
                                }

                                verify(accepting && client === this.client && accepted);
                            }).catch(() => {
                                trustError = new HostTrustError('SFTP host trust verification failed');
                                verify(false);
                            });
                        },
                    });
                }, options, () => {
                    accepting = false;
                    trustAbort.abort();
                });

                if (generation !== this.disconnectGeneration) {
                    throw new ConnectionClosedError('SFTP connection attempt was cancelled');
                }

                this.connected = true;
                this.connectionLost = false;
                this.everConnected = true;
                trustAbort.abort();
                this.emitState('ready', attempt + 1);

                return;
            } catch (error) {
                accepting = false;
                trustAbort.abort();
                this.connected = false;
                void this.closeClient(client);

                const sanitized = this.wrapError(error);
                const interruption = sanitized instanceof OperationAbortedError ||
                    sanitized instanceof OperationTimeoutError || sanitized instanceof ConnectionClosedError;
                const wrapped = trustError ?? authenticationError ?? (interruption ? sanitized :
                    classifyConnectionError(sanitized, stage));

                if (
                    generation !== this.disconnectGeneration ||
                    prompted ||
                    attempt >= options.maxTransientRetries ||
                    !isTransientError(wrapped)
                ) {
                    this.emitState('failed', attempt + 1, wrapped);
                    throw wrapped;
                }
            }
        }
    }

    private async authenticationForAttempt(
        purpose: 'connect' | 'reconnect', attempt: number, abortSignal: AbortSignal,
    ): Promise<SftpClient.ConnectOptions> {
        let authentication: SftpClient.ConnectOptions;

        if (this.config.credentialProvider) {
            let credentials;

            try {
                credentials = await this.config.credentialProvider(Object.freeze({
                    siteId: this.config.siteId,
                    host: this.config.host,
                    port: this.config.port,
                    protocol: 'sftp',
                    purpose,
                    attempt,
                    abortSignal,
                }));
            } catch {
                throw new CredentialProviderError('SFTP credential provider failed');
            }

            if (abortSignal.aborted) {
                throw new OperationAbortedError('SFTP credential request was cancelled');
            }

            const username = credentials?.username ?? this.config.username;

            if (credentials?.type === 'password' && typeof credentials.password === 'string') {
                authentication = {username, password: credentials.password, authHandler: ['password']};
            } else if (
                credentials?.type === 'private-key' &&
                (
                    typeof credentials.privateKey === 'string' ||
                    Buffer.isBuffer(credentials.privateKey)
                )
            ) {
                authentication = {
                    username,
                    privateKey: credentials.privateKey,
                    passphrase: credentials.passphrase,
                    authHandler: ['publickey'],
                };
            } else if (
                credentials?.type === 'agent' &&
                typeof credentials.socketPath === 'string' &&
                credentials.socketPath
            ) {
                authentication = {username, agent: credentials.socketPath, authHandler: ['agent']};
            } else {
                throw new CredentialProviderError('SFTP credential provider returned unsupported authentication material');
            }
        } else if (this.config.agent) {
            authentication = {username: this.config.username, agent: this.config.agent, authHandler: ['agent']};
        } else {
            const privateKey = this.config.privateKeyPath ?
                await readFile(this.config.privateKeyPath) : this.config.privateKey;

            authentication = {
                username: this.config.username,
                password: this.config.password,
                privateKey,
                passphrase: this.config.passphrase,
            };
        }

        authentication.privateKey = await prepareSshPrivateKey(authentication.privateKey, authentication.passphrase);

        if (abortSignal.aborted) {
            throw new OperationAbortedError('SFTP key preparation was cancelled');
        }

        for (const value of [authentication.password, authentication.passphrase, authentication.privateKey]) {
            if ((typeof value === 'string' || Buffer.isBuffer(value)) && value.length) {
                this.secrets.add(value.toString());
            }
        }

        return authentication;
    }

    private async answerChallenges(challenge: SftpKeyboardInteractiveChallenge): Promise<string[]> {
        const handler = this.config.keyboardInteractive;
        let answers: readonly string[];

        if (typeof handler === 'string') {
            if (challenge.prompts.length > 1) {
                throw new AuthError('A string keyboard-interactive answer requires a single prompt');
            }

            answers = challenge.prompts.length === 0 ? [] : [handler];
        } else if (typeof handler === 'function') {
            answers = await handler(Object.freeze({
                ...challenge,
                prompts: Object.freeze(challenge.prompts.map((prompt) => Object.freeze({...prompt}))),
            }));
        } else {
            throw new AuthError('Keyboard-interactive authentication requires a string or callback');
        }

        if (challenge.abortSignal.aborted) {
            throw new OperationAbortedError('Keyboard-interactive authentication was cancelled');
        }

        if (
            !Array.isArray(answers) ||
            answers.length !== challenge.prompts.length ||
            answers.some((answer) => typeof answer !== 'string')
        ) {
            throw new AuthError('Keyboard-interactive callback must return one string per prompt');
        }

        for (const answer of answers) {
            if (answer) {
                this.secrets.add(answer);
            }
        }

        return [...answers];
    }

    private async verifyHostKey(key: Buffer, abortSignal: AbortSignal): Promise<boolean> {
        if (this.config.hostVerifier) {
            const accepted = await new Promise<boolean>((resolve, reject) => {
                try {
                    const verifier = this.config.hostVerifier as (
                        key: Buffer,
                        verify: (accepted: boolean) => void,
                    ) => unknown;
                    const result = verifier(Buffer.from(key), (value) => resolve(value === true));

                    if (typeof result === 'boolean') {
                        resolve(result);
                    } else if (result && typeof (result as Promise<unknown>).then === 'function') {
                        void Promise.resolve(result).then((value) => resolve(value === true), reject);
                    }
                } catch (error) {
                    reject(error);
                }
            });

            if (!accepted || abortSignal.aborted) {
                return false;
            }
        }

        if (!this.config.hasTrustPolicy && !this.config.acceptTrustPolicy) {
            return true;
        }

        if (key.length < 4) {
            return false;
        }

        const algorithmLength = key.readUInt32BE(0);

        if (algorithmLength === 0 || algorithmLength > key.length - 4) {
            return false;
        }

        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
        const challenge: SftpHostKeyChallenge = {
            host: this.config.host,
            port: this.config.port,
            keyType: key.subarray(4, 4 + algorithmLength).toString('ascii'),
            fingerprint,
            publicKey: Buffer.from(key),
            previousFingerprint: this.previousFingerprint,
            changed: this.previousFingerprint !== undefined && this.previousFingerprint !== fingerprint,
            abortSignal,
        };
        const remembered = await this.config.hasTrustPolicy?.(challenge);

        if (abortSignal.aborted) {
            return false;
        }

        // A changed key observed by this connector always requires explicit acceptance.
        const accepted = remembered === true && !challenge.changed ?
            true :
            await this.config.acceptTrustPolicy?.({...challenge, publicKey: Buffer.from(key)});

        if (accepted === true && !abortSignal.aborted) {
            this.previousFingerprint = fingerprint;

            return true;
        }

        return false;
    }

    async disconnect(): Promise<void> {
        this.disconnectGeneration++;
        this.connectionFailed(this.client, new ConnectionClosedError('SFTP connector disconnected'));
        await this.closeClient(this.client);
        await this.connecting?.catch(() => {});
        this.connected = false;
        this.connectionLost = false;
        this.emitState('disconnected');
        this.secrets.clear();
    }

    private async ensureConnected(options: ResolvedConnectorOperationOptions): Promise<void> {
        this.checkAborted(options);

        if (!this.connected && this.connectionLost && !options.autoReconnect) {
            throw new ConnectionClosedError('SFTP connection was lost; call connect() or enable autoReconnect');
        }

        await this.connect(options);
    }

    private checkAborted(options: ConnectorOperationOptions): void {
        if (options.abortSignal?.aborted) {
            throw new OperationAbortedError('SFTP operation was aborted');
        }
    }

    private async withAttempt<T>(
        action: () => Promise<T>, options: ResolvedConnectorOperationOptions, cancel?: (error: Error) => void,
    ): Promise<T> {
        this.checkAborted(options);

        const client = this.client;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let fail: (error: Error) => void = () => {};
        const abort = () => {
            const error = new OperationAbortedError('SFTP operation was aborted');

            cancel?.(error);
            fail(error);
            this.invalidate(error, client);
        };

        try {
            return await new Promise<T>((resolve, reject) => {
                fail = (error) => {
                    cancel?.(error);
                    reject(error);
                };

                this.active.add(fail);
                options.abortSignal?.addEventListener('abort', abort, {once: true});

                if (options.timeoutMs > 0) {
                    timer = setTimeout(() => {
                        const error = new OperationTimeoutError('SFTP operation timed out');

                        cancel?.(error);
                        fail(error);
                        this.invalidate(error, client);
                    }, options.timeoutMs);
                }

                void Promise.resolve().then(() => {
                    this.checkAborted(options);

                    return action();
                }).then(resolve, reject);
            });
        } finally {
            this.active.delete(fail);
            options.abortSignal?.removeEventListener('abort', abort);

            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    private async run<T>(
        options: ConnectorOperationOptions, replaySafe: boolean,
        action: (client: SftpClient, attempt: OperationAttempt) => Promise<T>,
    ): Promise<T> {
        const resolved = resolveOperationOptions(this.config, options);
        const initiallyUnconnected = !this.connected && !this.connectionLost;
        const generation = this.disconnectGeneration;

        for (let attempt = 0; ; attempt++) {
            const deadline = resolved.timeoutMs > 0 ? performance.now() + resolved.timeoutMs : undefined;
            const operationAttempt: OperationAttempt = {number: attempt + 1, deadline};
            let started = false;
            let attemptClient: SftpClient | undefined;

            try {
                if (generation !== this.disconnectGeneration) {
                    throw new OperationAbortedError('SFTP operation was cancelled by disconnect');
                }

                // A single budget covers connection establishment and the operation.
                const connectionOptions = {...resolved, maxTransientRetries: 0};

                if (initiallyUnconnected && !this.connected) {
                    await this.connect(connectionOptions);
                } else {
                    await this.ensureConnected(connectionOptions);
                }

                if (generation !== this.disconnectGeneration) {
                    throw new OperationAbortedError('SFTP operation was cancelled by disconnect');
                }

                const remainingTimeout = deadline === undefined ? 0 : Math.ceil(deadline - performance.now());

                if (deadline !== undefined && remainingTimeout <= 0) {
                    throw new OperationTimeoutError('SFTP operation timed out while connecting');
                }

                started = true;
                attemptClient = this.client;

                const client = attemptClient;

                return await this.withAttempt(
                    () => action(client, operationAttempt),
                    {...resolved, timeoutMs: remainingTimeout},
                    (error) => {
                        operationAttempt.error = error;
                        operationAttempt.cancel?.(error);
                    },
                );
            } catch (error) {
                const wrapped = this.wrapError(error);

                operationAttempt.error = wrapped;
                operationAttempt.cancel?.(wrapped);

                if (generation !== this.disconnectGeneration) {
                    throw new OperationAbortedError('SFTP operation was cancelled by disconnect');
                }

                if (started && attemptClient && isTransientError(wrapped)) {
                    this.invalidate(wrapped, attemptClient);
                }

                const mayRetry = started ?
                    replaySafe && resolved.autoReconnect :
                    initiallyUnconnected || resolved.autoReconnect;

                if (!mayRetry || attempt >= resolved.maxTransientRetries || !isTransientError(wrapped)) {
                    throw wrapped;
                }
            }
        }
    }

    private wrapPath(path: string): string {
        if (
            typeof path !== 'string' ||
            Buffer.from(path, 'utf8').toString('utf8') !== path ||
            Buffer.from(this.config.initialPath, 'utf8').toString('utf8') !== this.config.initialPath
        ) {
            throw new NotSupportedError('SFTP filenames must round trip losslessly as UTF-8');
        }

        if (!this.config.initialPath || path.startsWith('/')) {
            return path;
        }

        return `${this.config.initialPath.replace(/\/$/, '')}/${path}`;
    }

    private wrapError(error: unknown): Error {
        if (error instanceof ConnectorError) {
            return error;
        }

        if (!(error instanceof Error)) {
            return new ConnectorError('Unknown SFTP transport error');
        }

        let message = error.message;

        for (const secret of [this.config.password, this.config.passphrase, ...this.secrets]) {
            if (secret) {
                message = message.split(secret).join('[REDACTED]');
            }
        }

        const details = error as Error & {code?: string | number; level?: string};

        if (/server does not support this extended request/i.test(message)) {
            return new NotSupportedError('The SFTP server does not support the requested extension');
        }

        if (
            details.level === 'client-authentication' ||
            /failed to .*agent|agent.*(?:failed|unavailable)|no keys loaded in agent/i.test(message) ||
            /authentication (?:methods )?failed|all configured authentication methods failed|cannot parse privatekey|bad passphrase|encrypted private key|unsupported key format/i.test(message)
        ) {
            return new AuthError(message);
        }

        if (/host (?:key|fingerprint).*verif|host key.*accept/i.test(message)) {
            return new HostTrustError(message);
        }

        if (
            details.level === 'client-timeout' ||
            (details.code === 'ERR_GENERIC_CLIENT' &&
                /timed? out|timeout/i.test(message))
        ) {
            return new OperationTimeoutError(message);
        }

        if (
            details.code === 'ERR_NOT_CONNECTED' ||
            (details.code === 'ERR_GENERIC_CLIENT' &&
                /unexpected (?:end|close) event/i.test(message))
        ) {
            return new ConnectionClosedError(message);
        }

        if (details.code === 2 || details.code === -2 || /no such file/i.test(message)) {
            return new NotFoundError(message);
        }

        if (details.code === 3 || /permission denied/i.test(message)) {
            return new PermissionError(message);
        }

        return new ConnectorError(message, undefined, details.code);
    }

    async write(path: string, contents: TransferContents, options: OperationOptions<WriteOptions> = {}): Promise<void> {
        const replaySafe = typeof contents === 'function';
        const usedStreams = new Set<Readable>();

        await this.run(options, replaySafe, async (client, attempt) => {
            const owned: {source?: Readable; destination?: ReturnType<SftpClient['createWriteStream']>} = {};

            attempt.cancel = () => {
                owned.source?.destroy();
                owned.destination?.destroy();
            };

            const source = typeof contents === 'function' ? await contents() : contents;

            owned.source = source;

            if (
                !(source instanceof Readable) ||
                source.destroyed ||
                source.readableEnded ||
                (replaySafe &&
                    source.readableDidRead) ||
                    usedStreams.has(source)
            ) {
                throw new ConnectorError('Upload source factory must return a fresh readable stream for each attempt');
            }

            usedStreams.add(source);

            if (attempt.error) {
                source.destroy();
                throw attempt.error;
            }

            if (resolveOperationOptions(this.config, options).abortSignal?.aborted) {
                source.destroy();
                throw new OperationAbortedError('SFTP upload was aborted while preparing its source');
            }

            if (client !== this.client || !this.connected) {
                source.destroy();
                throw new ConnectionClosedError('SFTP upload was cancelled before opening the remote file');
            }

            const monitor = createTransferMonitor({
                ...this.config,
                ...options,
                maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
            }, 'upload', attempt.number, path);

            try {
                const destination = client.createWriteStream(this.wrapPath(path), {autoClose: true, flags: 'w'});

                owned.destination = destination;
                await pipeline(source, monitor.stream, destination);
                monitor.complete();
            } catch (error) {
                monitor.fail(this.wrapError(error));
                throw error;
            } finally {
                monitor.dispose();
            }
        });
    }

    async read(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<FileContents> {
        return this.run(options, false, async (client, attempt) => {
            const resolved = resolveOperationOptions(this.config, options);
            const monitor = createTransferMonitor({
                ...this.config,
                ...options,
                maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
            }, 'download', attempt.number, path);
            const stream = monitor.stream;
            let sourceClosed = false;
            const complete = () => {
                if (sourceClosed && stream.readableEnded) {
                    monitor.complete();
                }
            };

            stream.once('end', complete);

            stream.on('error', () => {});

            let source: ReturnType<SftpClient['createReadStream']>;

            try {
                source = client.createReadStream(this.wrapPath(path), {autoClose: true});
            } catch (error) {
                monitor.fail(this.wrapError(error));
                throw this.wrapError(error);
            }

            let timer: ReturnType<typeof setTimeout> | undefined;
            const fail = (error: Error) => {
                const wrapped = this.wrapError(error);

                monitor.fail(wrapped);
                stream.destroy(wrapped);
            };
            const abort = () => fail(new OperationAbortedError('SFTP read was aborted'));

            this.active.add(fail);
            resolved.abortSignal?.addEventListener('abort', abort, {once: true});

            if (attempt.deadline !== undefined) {
                timer = setTimeout(() => fail(new OperationTimeoutError('SFTP read timed out')), Math.max(1, Math.ceil(attempt.deadline - performance.now())));
            }

            source.on('error', fail);
            source.once('end', () => stream.end());
            source.once('close', () => {
                sourceClosed = true;
                complete();

                if (!source.readableEnded && !stream.destroyed) {
                    fail(new ConnectionClosedError('SFTP read closed before completion'));
                }
            });
            stream.once('close', () => {
                monitor.dispose();
                this.active.delete(fail);
                resolved.abortSignal?.removeEventListener('abort', abort);

                if (timer) {
                    clearTimeout(timer);
                }

                source.unpipe(stream);
                source.destroy();
            });
            source.pipe(stream, {end: false});

            if (resolved.abortSignal?.aborted) {
                abort();
            }

            return stream;
        });
    }

    async deleteFile(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            await client.delete(this.wrapPath(path), false);
        });
    }

    async createDirectory(path: string, options: OperationOptions<CreateDirectoryOptions> = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            await client.mkdir(this.wrapPath(path), true);
        });
    }

    public async createDirectoryExclusive(path: string, options: ConnectorOperationOptions = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            const result = await client.mkdir(this.wrapPath(path), false);

            // Upstream mkdir also resolves for existing directories; only this reply confirms ownership.
            if (typeof result !== 'string' || !result.endsWith(' directory created')) {
                throw new ConnectorError('Exclusive SFTP mkdir did not confirm a new directory');
            }
        });
    }

    public async removeEmptyDirectory(path: string, options: ConnectorOperationOptions = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            await client.rmdir(this.wrapPath(path), false);
        });
    }

    public async renameFile(from: string, to: string, options: ConnectorOperationOptions & {
        overwrite: 'fail' | 'replace';
        requireAtomicRename?: boolean;
    }): Promise<{atomic: boolean}> {
        if (options.overwrite !== 'fail' && options.overwrite !== 'replace') {
            throw new ConnectorError('renameFile requires overwrite: fail or replace');
        }

        if (options.overwrite === 'fail' && options.requireAtomicRename) {
            throw new NotSupportedError('Atomic no-replace rename cannot be guaranteed by SFTP v3');
        }

        return this.run(options, false, async (client) => {
            if (options.overwrite === 'replace') {
                await client.posixRename(this.wrapPath(from), this.wrapPath(to));

                return {atomic: true};
            }

            await client.rename(this.wrapPath(from), this.wrapPath(to));

            return {atomic: false};
        });
    }

    public async serverFeatures(options: ConnectorOperationOptions = {}): Promise<readonly string[]> {
        await this.connect(options);

        // ssh2-sftp-client has no documented extension inventory API.
        return [];
    }

    async deleteDirectory(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            await client.rmdir(this.wrapPath(path), true);
        });
    }

    async fileExists(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<boolean> {
        try {
            return (await this.stat(path, options)).type === 'file';
        } catch (error) {
            if (error instanceof NotFoundError) {
                return false;
            }

            throw error;
        }
    }

    async directoryExists(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<boolean> {
        try {
            return (await this.stat(path, options)).type === 'directory';
        } catch (error) {
            if (error instanceof NotFoundError) {
                return false;
            }

            throw error;
        }
    }

    async *list(
        path: string,
        options: OperationOptions<AdapterListOptions> = {deep: false},
    ): AsyncGenerator<StatEntry> {
        const entries = await this.run(options, true, (client) => client.list(this.wrapPath(path)));

        for (const entry of entries) {
            this.checkAborted(resolveOperationOptions(this.config, options));

            const entryPath = path ? `${path.replace(/\/$/, '')}/${entry.name}` : entry.name;

            if (entry.type === 'd') {
                const directory: DirectoryInfo = {
                    type: 'directory',
                    path: entryPath,
                    isFile: false,
                    isDirectory: true,
                    lastModifiedMs: entry.modifyTime,
                };

                yield directory;

                if (options.deep) {
                    yield* this.list(entryPath, options);
                }
            } else {
                const file: FileInfo & {isSymbolicLink: boolean; isUnsupported: boolean} = {
                    type: 'file',
                    path: entryPath,
                    isFile: true,
                    isDirectory: false,
                    size: entry.size,
                    isSymbolicLink: entry.type === 'l',
                    isUnsupported: entry.type !== '-',
                    lastModifiedMs: entry.modifyTime,
                };

                yield file;
            }
        }
    }

    async moveFile(from: string, to: string, options: OperationOptions<MoveFileOptions> = {}): Promise<void> {
        await this.run(options, false, async (client) => {
            await client.rename(this.wrapPath(from), this.wrapPath(to));
        });
    }

    async copyFile(
        from: string, to: string, options: OperationOptions<CopyFileOptions> & CopyStrategyOptions = {},
    ): Promise<void> {
        await this.copyFileWithStrategy(from, to, options);
    }

    public async copyFileWithStrategy(
        from: string, to: string, options: CopyStrategyOptions = {},
    ): Promise<CopyResult> {
        return copyFileWithStrategy(this, from, to, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public validatePublicationOptions(options: PublishFileOptions): void {
        resolveOperationOptions(this.config, options);
        resolveByteLimit(options.verify?.maxBytes);

        if (options.requireAtomicRename && (options.overwrite ?? 'fail') === 'fail') {
            throw new NotSupportedError('Atomic no-replace rename cannot be guaranteed by SFTP v3');
        }
    }

    public async publishFile(path: string, contents: TransferContents, options: PublishFileOptions = {}) {
        return publishTransfer(this, path, contents, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public async checksumDetails(path: string, options: ChecksumDetailsOptions = {}) {
        return calculateChecksum(this, path, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public walk(path: string, options: WalkOptions = {}) {
        return walkDirectory(this, path, {
            ...this.config,
            ...options,
            maxBytes: options.maxBytes === undefined ? this.config.maxBytes : options.maxBytes,
        });
    }

    public async capabilities(options: ConnectorOperationOptions & {negotiate?: boolean} = {}) {
        return describeCapabilities('sftp', options.negotiate ? await this.serverFeatures(options) : undefined);
    }

    async stat(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<StatEntry> {
        return this.run(options, true, async (client) => {
            // The community declaration omits this documented runtime method.
            const stats = await (client as SftpClient & {
                lstat(path: string): Promise<SftpClient.FileStats>;
            }).lstat(this.wrapPath(path));

            if (stats.isSymbolicLink || (!stats.isDirectory && !stats.isFile)) {
                throw new NotSupportedError(`Symbolic link or special file cannot be followed: ${path}`);
            }

            if (stats.isDirectory) {
                return {
                    type: 'directory',
                    path,
                    isFile: false,
                    isDirectory: true,
                    lastModifiedMs: stats.modifyTime,
                };
            }

            return {
                type: 'file',
                path,
                isFile: true,
                isDirectory: false,
                size: stats.size,
                lastModifiedMs: stats.modifyTime,
            };
        });
    }

    async changeVisibility(
        _path: string,
        _visibility: string,
        _options: OperationOptions<MiscellaneousOptions> = {},
    ): Promise<void> {
        throw new NotSupportedError('SFTP visibility not supported');
    }

    async visibility(_path: string, _options: OperationOptions<MiscellaneousOptions> = {}): Promise<string> {
        throw new NotSupportedError('SFTP visibility not supported');
    }

    async publicUrl(_path: string, _options: OperationOptions<PublicUrlOptions> = {}): Promise<string> {
        throw new NotSupportedError('SFTP publicUrl not supported');
    }

    async temporaryUrl(_path: string, _options: OperationOptions<TemporaryUrlOptions>): Promise<string> {
        throw new NotSupportedError('SFTP temporaryUrl not supported');
    }

    async checksum(
        path: string, options: OperationOptions<ChecksumOptions> & ChecksumDetailsOptions = {},
    ): Promise<string> {
        const result = await this.checksumDetails(path, {...options, algorithm: options.algorithm ?? options.algo});

        return Buffer.from(result.digest, 'hex').toString(options.encoding ?? 'hex');
    }

    async mimeType(_path: string, _options: OperationOptions<MimeTypeOptions> = {}): Promise<string> {
        throw new NotSupportedError('SFTP mimeType not supported');
    }

    async lastModified(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<number> {
        const entry = await this.stat(path, options);

        if (entry.lastModifiedMs === undefined) {
            throw new ConnectorError('Last modified not available');
        }

        return entry.lastModifiedMs;
    }

    async fileSize(path: string, options: OperationOptions<MiscellaneousOptions> = {}): Promise<number> {
        const entry = await this.stat(path, options);

        if (entry.type !== 'file' || entry.size === undefined) {
            throw new ConnectorError('File size not available');
        }

        return entry.size;
    }

    public static _wrapErrorForTest(error: unknown, config: Partial<SftpConnectorConfig> = {}): Error {
        return new SftpConnector({
            host: '',
            port: 22,
            username: '',
            initialPath: '',
            ...config,
        }).wrapError(error);
    }
}
