<!-- Generated from public package declarations by scripts/generate-api-docs.mjs. -->
# TypeScript reference

These signatures come from the public package entry points and their re-exports. Build the libraries and run `npm run docs:api` to update them. Use the API guide for behavior and examples.

## @jalsoedesign/dockline-abstract

### index.d.ts

```ts
export * from './errors.js';
export { isTransientError, resolveOperationOptions } from './operation-options.js';
export type { ConnectorOperationOptions, ResolvedConnectorOperationOptions, TransferContents, TransferSourceFactory } from './operation-options.js';
export * from './connection-options.js';
export * from './transfer-monitor.js';
export * from './transfer-tools.js';
export * from './capabilities.js';
export * from './ConnectorPool.js';
export { resolveByteLimit } from './byte-limit.js';
export * from './configuration.js';
export type { TransferAdapter } from './TransferAdapter.js';
```

### errors.d.ts

```ts
export type ConnectionStage = 'resolve' | 'connect' | 'trust' | 'authenticate' | 'directory' | 'credentials' | 'ready';
export declare class ConnectorError extends Error {
    readonly cause?: unknown | undefined;
    readonly code?: string | number | undefined;
    readonly stage?: ConnectionStage | undefined;
    constructor(message: string, cause?: unknown | undefined, code?: string | number | undefined, stage?: ConnectionStage | undefined);
}
export declare class AuthError extends ConnectorError {
    readonly stage: ConnectionStage;
}
export declare class NotFoundError extends ConnectorError {
}
export declare class PermissionError extends ConnectorError {
}
export declare class UnsupportedProtocolError extends ConnectorError {
}
export declare class NotSupportedError extends ConnectorError {
}
export declare class OperationAbortedError extends ConnectorError {
    constructor(message?: string);
}
export declare class OperationTimeoutError extends ConnectorError {
    constructor(message?: string);
}
export declare class ConnectionClosedError extends ConnectorError {
    constructor(message?: string);
}
export declare class HostTrustError extends ConnectorError {
    constructor(message?: string);
}
export declare class NameResolutionError extends ConnectorError {
    constructor(message?: string, code?: string);
}
export declare class ConnectionRefusedError extends ConnectorError {
    constructor(message?: string);
}
export declare class TlsTrustError extends HostTrustError {
}
export declare class CredentialProviderError extends AuthError {
    readonly stage: ConnectionStage;
    constructor(message?: string);
}
export declare class DirectoryAccessError extends ConnectorError {
    constructor(message?: string, code?: string | number);
}
export declare class ResourceLimitError extends ConnectorError {
}
export declare class IntegrityError extends ConnectorError {
}
export declare class PoolClosedError extends ConnectorError {
}
export declare class PublicationError extends ConnectorError {
    readonly state: Readonly<{
        destination: string;
        temporaryPath?: string;
        phase: 'prepare' | 'upload' | 'verify' | 'rename' | 'cleanup';
        outcome: 'not-published' | 'published' | 'uncertain';
        cleanup: 'done' | 'retained' | 'failed';
    }>;
    constructor(message: string, state: Readonly<{
        destination: string;
        temporaryPath?: string;
        phase: 'prepare' | 'upload' | 'verify' | 'rename' | 'cleanup';
        outcome: 'not-published' | 'published' | 'uncertain';
        cleanup: 'done' | 'retained' | 'failed';
    }>);
}
```

### operation-options.d.ts

```ts
import type { Readable } from 'node:stream';
import type { BandwidthBudget, TransferProgressEvent } from './transfer-monitor.js';
export type TransferSourceFactory = () => Readable | Promise<Readable>;
export type TransferContents = Readable | TransferSourceFactory;
export interface ConnectorOperationOptions {
    autoReconnect?: boolean;
    /** Additional attempts after the first attempt, for safe transient failures. */
    maxTransientRetries?: number;
    /** Per-attempt deadline in milliseconds. Zero disables this deadline. */
    timeoutMs?: number;
    /** Flystorage-compatible alias for timeoutMs. */
    timeout?: number;
    abortSignal?: AbortSignal;
    /** Optional observers never change the outcome of a transfer. */
    onProgress?: (event: TransferProgressEvent) => void;
    totalBytes?: number;
    /** Optional per-transfer byte limit. Undefined inherits; Infinity explicitly removes a configured limit. */
    maxBytes?: number;
    progressIntervalMs?: number;
    /** Bytes per second for this transfer, or an explicit shared budget. */
    bandwidth?: number | BandwidthBudget;
}
export interface ResolvedConnectorOperationOptions {
    autoReconnect: boolean;
    maxTransientRetries: number;
    timeoutMs: number;
    abortSignal?: AbortSignal;
}
export declare function resolveOperationOptions(defaults?: ConnectorOperationOptions, overrides?: ConnectorOperationOptions): ResolvedConnectorOperationOptions;
export declare function isTransientError(error: unknown): boolean;
```

### connection-options.d.ts

```ts
import { ConnectorError, type ConnectionStage } from './errors.js';
export type ConnectorProtocol = 'ftp' | 'sftp';
export interface CredentialContext {
    readonly siteId?: string;
    readonly host: string;
    readonly port: number;
    readonly protocol: ConnectorProtocol;
    readonly purpose: 'connect' | 'reconnect';
    readonly attempt: number;
    readonly abortSignal: AbortSignal;
}
export type ConnectorCredentials = {
    type: 'password';
    username?: string;
    password: string;
} | {
    type: 'private-key';
    username?: string;
    privateKey: string | Buffer;
    passphrase?: string;
} | {
    type: 'agent';
    username?: string;
    socketPath: string;
};
export type CredentialProvider = (context: CredentialContext) => ConnectorCredentials | Promise<ConnectorCredentials>;
export interface KeepaliveOptions {
    intervalMs: number;
    maxMissed?: number;
}
export interface ConnectionStateEvent {
    readonly state: 'connecting' | 'ready' | 'disconnected' | 'reconnecting' | 'failed';
    readonly protocol: ConnectorProtocol;
    readonly attempt: number;
    readonly error?: ConnectorError;
}
export interface ConnectorConnectionOptions {
    siteId?: string;
    credentialProvider?: CredentialProvider;
    keepalive?: KeepaliveOptions;
    onConnectionState?: (event: ConnectionStateEvent) => void;
}
/** State callbacks observe the connection; callback failures never change network outcomes. */
export declare function emitConnectionState(callback: ConnectorConnectionOptions['onConnectionState'], event: ConnectionStateEvent): void;
/** Callers sanitize transport messages before invoking this classifier. Raw causes are never retained. */
export declare function classifyConnectionError(error: unknown, stage: ConnectionStage): ConnectorError;
```

### transfer-monitor.d.ts

```ts
import { Transform } from 'node:stream';
import type { ConnectorOperationOptions } from './operation-options.js';
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
/** FIFO byte quanta; a shared instance has an independent aggregate budget for each direction. */
export declare class BandwidthBudget {
    readonly bytesPerSecond: number;
    readonly burstBytes: number;
    private readonly queues;
    constructor(options: {
        bytesPerSecond: number;
        burstBytes?: number;
    });
    consume(bytes: number, signal?: AbortSignal, direction?: TransferDirection): Promise<void>;
    private wait;
    private schedule;
}
export interface TransferMonitor {
    readonly stream: Transform;
    complete(): void;
    fail(error?: unknown): void;
    dispose(): void;
}
export declare function createTransferMonitor(options: ConnectorOperationOptions, direction: TransferDirection, attempt: number, path?: string): TransferMonitor;
```

### transfer-tools.d.ts

```ts
import { Readable } from 'node:stream';
import type { StatEntry, StorageAdapter } from '@flystorage/file-storage';
import type { ConnectorOperationOptions, TransferContents } from './operation-options.js';
export interface TransferConnector extends Pick<StorageAdapter, 'read' | 'stat' | 'list' | 'deleteFile' | 'deleteDirectory'> {
    validatePublicationOptions(options: PublishFileOptions): void;
    write(path: string, contents: TransferContents, options: ConnectorOperationOptions): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: RenameOptions): Promise<{
        atomic: boolean;
    }>;
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
export declare function checkAbort(signal?: AbortSignal): void;
export declare function toReadable(contents: Awaited<ReturnType<StorageAdapter['read']>>): Readable;
export declare function checksumDetails(connector: Pick<TransferConnector, 'read' | 'stat' | 'serverChecksum'>, path: string, options?: ChecksumDetailsOptions): Promise<ChecksumResult>;
export interface PublishFileOptions extends ConnectorOperationOptions {
    overwrite?: 'fail' | 'replace';
    requireAtomicRename?: boolean;
    verify?: {
        algorithm?: 'sha256' | 'sha512';
        expectedDigest: string;
        maxBytes?: number;
    };
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
export declare function publishFile(connector: TransferConnector, destination: string, contents: TransferContents, options?: PublishFileOptions): Promise<PublicationResult>;
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
export declare function copyFileWithStrategy(connector: TransferConnector, from: string, to: string, options?: CopyStrategyOptions): Promise<CopyResult>;
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
export declare function walk(connector: Pick<TransferConnector, 'list'>, root: string, options?: WalkOptions): {
    entries: AsyncGenerator<StatEntry>;
    result: Promise<WalkResult>;
};
```

### capabilities.d.ts

```ts
import type { ConnectorProtocol } from './connection-options.js';
export type SupportState = 'supported' | 'unsupported' | 'unknown';
export interface Capability {
    readonly state: SupportState;
    readonly condition?: string;
    readonly algorithms?: readonly string[];
}
export interface ConnectorCapabilities {
    readonly schemaVersion: 1;
    readonly protocol: ConnectorProtocol;
    readonly adapter: Readonly<Record<string, Capability>>;
    readonly server: Readonly<Record<string, Capability>>;
    /** Whether server inventory was requested, even if the transport cannot expose it. */
    readonly negotiated: boolean;
    readonly inventory: 'not-requested' | 'advertised' | 'unavailable';
    readonly features: readonly string[];
}
/** Pass features only from the current verified session. This helper never opens a connection or caches identity. */
export declare function describeCapabilities(protocol: ConnectorProtocol, features?: readonly string[]): ConnectorCapabilities;
```

### ConnectorPool.d.ts

```ts
import type { ConnectorOperationOptions } from './operation-options.js';
export interface PoolConnection {
    connect(options?: ConnectorOperationOptions): Promise<void>;
    disconnect(): Promise<void>;
}
export interface PoolOptions<T extends PoolConnection> {
    create: (context: {
        abortSignal: AbortSignal;
    }) => T | Promise<T>;
    maxConnections?: number;
    /** Optional server connection ceiling; zero means no extra server limit. */
    serverMaxConnections?: number;
    idleTimeoutMs?: number;
}
export interface ConnectionLease<T> {
    readonly connector: T;
    /** Waits for every tracked operation, returned stream and iterator before making the session available. */
    release(): Promise<void>;
}
/** Every leased operation counts equally, including directory listings and metadata requests. */
export declare class ConnectorPool<T extends PoolConnection> {
    private readonly options;
    readonly maxConnections: number;
    private readonly idle;
    private readonly active;
    private readonly waiters;
    private readonly creating;
    private readonly closingListeners;
    private total;
    private closed;
    private readonly idleTimeoutMs;
    constructor(options: PoolOptions<T>);
    get stats(): Readonly<{
        limit: number;
        connections: number;
        active: number;
        queued: number;
    }>;
    acquire(options?: ConnectorOperationOptions): Promise<ConnectionLease<T>>;
    private pump;
    private prepare;
    private lease;
    withConnection<R>(operation: (connector: T) => R | Promise<R>, options?: ConnectorOperationOptions): Promise<R>;
    private dispose;
    private changed;
    close(options?: {
        force?: boolean;
        timeoutMs?: number;
    }): Promise<void>;
}
```

### byte-limit.d.ts

```ts
/** Undefined leaves transfer size unrestricted; Infinity explicitly overrides an inherited limit. */
export declare function resolveByteLimit(value: number | undefined): number;
```

### configuration.d.ts

```ts
import type { ConnectionOptions } from 'node:tls';
import type { ConnectorConnectionOptions } from './connection-options.js';
import type { ConnectorOperationOptions } from './operation-options.js';
export interface FtpFilenameEncodingOptions {
    charset: string;
    onUnrepresentable?: 'reject';
}
export type FtpFilenameEncoding = 'utf8' | 'ascii' | 'latin1';
export interface FtpConnectorConfig extends ConnectorOperationOptions, ConnectorConnectionOptions {
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean | 'implicit';
    initialPath: string;
    passive: boolean | null;
    secureOptions?: ConnectionOptions;
    filenameEncoding?: FtpFilenameEncodingOptions;
}
export interface SftpHostKeyChallenge {
    readonly host: string;
    readonly port: number;
    readonly keyType: string;
    /** OpenSSH-style SHA256 fingerprint without base64 padding. */
    readonly fingerprint: string;
    /** SSH wire-format public key, not a private authentication key. */
    readonly publicKey: Buffer;
    readonly previousFingerprint?: string;
    readonly changed: boolean;
    /** Cancel pending UI work when this connection attempt is abandoned. */
    readonly abortSignal: AbortSignal;
}
export type SftpTrustPolicy = (challenge: SftpHostKeyChallenge) => boolean | Promise<boolean>;
export type SftpHostVerifier = ((key: Buffer) => boolean | Promise<boolean>) | ((key: Buffer, verify: (accepted: boolean) => void) => void);
export interface SftpKeyboardInteractiveChallenge {
    readonly name: string;
    readonly instructions: string;
    readonly language: string;
    readonly prompts: readonly {
        readonly prompt: string;
        readonly echo: boolean;
    }[];
    readonly abortSignal: AbortSignal;
}
export type SftpKeyboardInteractive = string | ((challenge: SftpKeyboardInteractiveChallenge) => readonly string[] | Promise<readonly string[]>);
export interface SftpConnectorConfig extends ConnectorOperationOptions, ConnectorConnectionOptions {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string | Buffer;
    privateKeyPath?: string;
    passphrase?: string;
    initialPath: string;
    /** POSIX socket, Windows OpenSSH named pipe, Cygwin socket, or 'pageant'. No automatic discovery. */
    agent?: string;
    /** Forwarding is deliberately unsupported; authentication never exposes the agent to the server. */
    agentForward?: false;
    /** A string answers a single prompt; multi-prompt exchanges require the callback. */
    keyboardInteractive?: SftpKeyboardInteractive;
    /** SFTP supports UTF-8 filenames only. File-content bytes are never transcoded. */
    filenameEncoding?: {
        charset: string;
        onUnrepresentable?: 'reject';
    };
    hostVerifier?: SftpHostVerifier;
    readyTimeout?: number;
    /** Opt in to requiring both application-provided trust hooks. */
    requireTrustPolicy?: boolean;
    /** Look up this exact host, port and public key before asking for acceptance. */
    hasTrustPolicy?: SftpTrustPolicy;
    /** Ask the application's CLI/UI to approve; persistence belongs to the application. */
    acceptTrustPolicy?: SftpTrustPolicy;
}
export interface FtpTransferConfig extends Omit<FtpConnectorConfig, 'user' | 'password' | 'port' | 'secure' | 'initialPath' | 'passive'> {
    protocol: 'ftp' | 'ftps' | 'ftps-implicit';
    username: string;
    password?: string;
    port?: number;
    root?: string;
    passive?: boolean | null;
}
export interface SftpTransferConfig extends Omit<SftpConnectorConfig, 'port' | 'initialPath'> {
    protocol: 'sftp';
    port?: number;
    root?: string;
}
export type TransferConfig = FtpTransferConfig | SftpTransferConfig;
export type TransferProtocol = TransferConfig['protocol'];
/** Validate shared configuration without loading or connecting either transport. */
export declare function validateTransferConfig(config: TransferConfig): {
    port: number;
    root: string;
};
```

### TransferAdapter.d.ts

```ts
import type { StorageAdapter, WriteOptions } from '@flystorage/file-storage';
import type { ConnectorCapabilities } from './capabilities.js';
import type { ConnectorOperationOptions, TransferContents } from './operation-options.js';
import type { ChecksumDetailsOptions, ChecksumResult, CopyStrategyOptions, CopyResult, PublishFileOptions, PublicationResult, RenameOptions, WalkOptions, walk } from './transfer-tools.js';
/** The shared transfer contract implemented by protocol clients and custom adapters. */
export interface TransferAdapter extends Omit<StorageAdapter, 'write'> {
    connect(options?: ConnectorOperationOptions): Promise<void>;
    disconnect(): Promise<void>;
    write(path: string, contents: TransferContents, options: WriteOptions & ConnectorOperationOptions): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: RenameOptions): Promise<{
        atomic: boolean;
    }>;
    serverFeatures(options?: ConnectorOperationOptions): Promise<readonly string[]>;
    serverChecksum?(path: string, algorithm: 'sha256' | 'sha512', options?: ConnectorOperationOptions): Promise<string>;
    validatePublicationOptions(options: PublishFileOptions): void;
    publishFile(path: string, contents: TransferContents, options?: PublishFileOptions): Promise<PublicationResult>;
    checksumDetails(path: string, options?: ChecksumDetailsOptions): Promise<ChecksumResult>;
    copyFileWithStrategy(from: string, to: string, options?: CopyStrategyOptions): Promise<CopyResult>;
    walk(path: string, options?: WalkOptions): ReturnType<typeof walk>;
    capabilities(options?: ConnectorOperationOptions & {
        negotiate?: boolean;
    }): Promise<ConnectorCapabilities>;
}
```

## @jalsoedesign/dockline-cli

### index.d.ts

```ts
export { createProgram, runCli } from './program.js';
export { loadCliConfig, resolveCliCommandDefaults, CliConfigError } from './config.js';
export type { CliCommand, CliCommandOptions, CliCommandDefaults, CliTrustConfig, LoadedCliConfig } from './config.js';
export type { CliContext } from './context.js';
export type { CliResult } from './execution.js';
export { CliUsageError } from './errors.js';
```

### program.d.ts

```ts
import { Command } from 'commander';
import { type CliContext } from './context.js';
/** Build a fresh Commander program. Embedders control parsing and error handling. */
export declare function createProgram(context?: CliContext): Command;
/** Run without terminating the process or registering process-wide signal handlers. */
export declare function runCli(argv?: readonly string[], context?: CliContext): Promise<number>;
```

### config.d.ts

```ts
import { type ConnectorOperationOptions, type TransferConfig } from '@jalsoedesign/dockline-core';
export type CliCommand = 'download' | 'upload' | 'list' | 'remove';
export interface CliCommandOptions extends Pick<ConnectorOperationOptions, 'autoReconnect' | 'maxTransientRetries' | 'timeoutMs' | 'maxBytes'> {
    bandwidth?: number;
}
export interface CliCommandDefaults extends CliCommandOptions {
    sourceFile?: string;
    destinationFile?: string;
    path?: string;
    overwrite?: 'fail' | 'replace';
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
}
export interface CliTrustConfig {
    fingerprint?: string;
    knownHostsFile?: string;
}
export interface LoadedCliConfig {
    connection: TransferConfig;
    trust?: CliTrustConfig;
    defaults: CliCommandDefaults;
    commands: Partial<Record<CliCommand, CliCommandDefaults>>;
    configFile: string;
}
export declare class CliConfigError extends Error {
    constructor(message: string);
}
/** Merge YAML defaults before command-line overrides and resolve only this command's local path. */
export declare function resolveCliCommandDefaults(config: LoadedCliConfig, command: CliCommand): CliCommandDefaults;
export declare function loadCliConfig(filename: string, options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}): Promise<LoadedCliConfig>;
```

### context.d.ts

```ts
import type { Readable, Writable } from 'node:stream';
export interface CliContext {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: Readable & {
        isTTY?: boolean;
    };
    stdout?: Writable & {
        isTTY?: boolean;
    };
    stderr?: Writable & {
        isTTY?: boolean;
    };
    signal?: AbortSignal;
}
export interface ResolvedCliContext extends CliContext {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdin: Readable & {
        isTTY?: boolean;
    };
    stdout: Writable & {
        isTTY?: boolean;
    };
    stderr: Writable & {
        isTTY?: boolean;
    };
}
export declare function resolveContext(context: CliContext): ResolvedCliContext;
```

### execution.d.ts

```ts
import { type CliCommand, type LoadedCliConfig } from './config.js';
import type { ResolvedCliContext } from './context.js';
export interface CliOverrides {
    sourceFile?: string;
    destinationFile?: string;
    path?: string;
    overwrite?: 'fail' | 'replace';
    recursive?: boolean;
}
interface Entry {
    path: string;
    type: string;
    size?: number;
    lastModifiedMs?: number;
    isSymbolicLink?: boolean;
    isUnsupported?: boolean;
}
export type CliResult = {
    ok: true;
    command: 'download' | 'upload';
    sourceFile: string;
    destinationFile: string;
    bytesTransferred: number;
} | {
    ok: true;
    command: 'list';
    path: string;
    entries: Entry[];
    complete: true;
} | {
    ok: true;
    command: 'remove';
    path: string;
    removed: number;
};
export declare function executeCommand(command: CliCommand, config: LoadedCliConfig, overrides: CliOverrides, context: ResolvedCliContext, json: boolean): Promise<CliResult>;
export {};
```

### errors.d.ts

```ts
export declare class CliUsageError extends Error {
    readonly code = "DOCKLINE_USAGE_ERROR";
    constructor(message: string);
}
/** Server-controlled text must never become terminal control sequences. */
export declare function terminalText(value: string): string;
export declare function redactText(value: string, secrets: readonly string[]): string;
```

## @jalsoedesign/dockline-core

### index.d.ts

```ts
export * from '@jalsoedesign/dockline-abstract';
export * from './Dockline.js';
export { MissingClientPackageError } from './client-loader.js';
```

### Dockline.d.ts

```ts
import { Readable } from 'node:stream';
import { ConnectorPool, type ConnectorOperationOptions, type TransferContents, type PoolOptions, type PublishFileOptions, type ChecksumDetailsOptions, type CopyStrategyOptions, type RenameOptions, type WalkOptions, type TransferAdapter, type TransferConfig } from '@jalsoedesign/dockline-abstract';
export { createConnector } from './client-loader.js';
export type { FtpTransferConfig, SftpTransferConfig, TransferConfig, TransferProtocol, TransferAdapter } from '@jalsoedesign/dockline-abstract';
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
/** SDK paths are relative to the configured root, independently of the local operating system. */
export declare function relativeRemotePath(value: string, allowRoot?: boolean): string;
/** A small API over one explicit transport session. Advanced adapters remain directly accessible. */
export declare class Dockline {
    readonly connector: TransferAdapter;
    private readonly defaultSignal?;
    private readonly defaultMaxBytes;
    private readonly description;
    constructor(config: TransferConfig);
    static create(config: TransferConfig): Dockline;
    static connect(config: TransferConfig): Promise<Dockline>;
    static withConnection<T>(config: TransferConfig, callback: (remote: Dockline) => Promise<T>): Promise<T>;
    static createPool(config: TransferConfig, options?: Omit<PoolOptions<Dockline>, 'create'>): ConnectorPool<Dockline>;
    toJSON(): object;
    connect(options?: ConnectorOperationOptions): Promise<void>;
    disconnect(): Promise<void>;
    list(remotePath?: string, options?: TransferListOptions): AsyncGenerator<import("@flystorage/file-storage").StatEntry, any, any>;
    stat(remotePath: string, options?: ConnectorOperationOptions): Promise<import("@flystorage/file-storage").StatEntry>;
    read(remotePath: string, options?: ConnectorOperationOptions): Promise<Readable>;
    write(remotePath: string, contents: string | Buffer | TransferContents, options?: ConnectorOperationOptions): Promise<void>;
    uploadFile(localPath: string, remotePath: string, options?: UploadFileOptions): Promise<void>;
    downloadFile(remotePath: string, localPath: string, options?: DownloadFileOptions): Promise<void>;
    deleteFile(remotePath: string, options?: ConnectorOperationOptions): Promise<void>;
    createDirectory(remotePath: string, options?: ConnectorOperationOptions): Promise<void>;
    rename(from: string, to: string, options: RenameOptions): Promise<{
        atomic: boolean;
    }>;
    publishFile(remotePath: string, contents: TransferContents, options?: PublishFileOptions): Promise<import("@jalsoedesign/dockline-abstract").PublicationResult>;
    checksumDetails(remotePath: string, options?: ChecksumDetailsOptions): Promise<import("@jalsoedesign/dockline-abstract").ChecksumResult>;
    copyFile(from: string, to: string, options?: CopyStrategyOptions): Promise<import("@jalsoedesign/dockline-abstract").CopyResult>;
    walk(remotePath?: string, options?: WalkOptions): {
        entries: AsyncGenerator<import("@flystorage/file-storage").StatEntry>;
        result: Promise<import("@jalsoedesign/dockline-abstract").WalkResult>;
    };
    capabilities(options?: Parameters<TransferAdapter['capabilities']>[0]): Promise<import("@jalsoedesign/dockline-abstract").ConnectorCapabilities>;
}
```

### client-loader.d.ts

```ts
import { ConnectorError, type TransferAdapter, type TransferConfig, type TransferProtocol } from '@jalsoedesign/dockline-abstract';
type ClientPackageName = '@jalsoedesign/dockline-ftp-client' | '@jalsoedesign/dockline-sftp-client';
export declare class MissingClientPackageError extends ConnectorError {
    readonly protocol: TransferProtocol;
    readonly packageName: ClientPackageName;
    readonly installCommand: string;
    constructor(protocol: TransferProtocol, packageName: ClientPackageName);
}
/** Resolve one installed client without importing or installing the other protocol. */
export declare function createConnector(config: TransferConfig): TransferAdapter;
export {};
```

## @jalsoedesign/dockline-ftp-client

### index.d.ts

```ts
export { FtpConnector } from './FtpConnector.js';
export * from './errors.js';
export type { FtpConnectorConfig, FtpUploadSource } from './FtpConnector.js';
export type { ConnectorOperationOptions } from '@jalsoedesign/dockline-abstract';
export * from './filename-encoding.js';
export type { ConnectorConnectionOptions, CredentialProvider, ConnectionStateEvent } from '@jalsoedesign/dockline-abstract';
export { createConnector } from './createConnector.js';
export type { FtpTransferConfig, TransferAdapter } from '@jalsoedesign/dockline-abstract';
```

### FtpConnector.d.ts

```ts
import { type FtpConnectorConfig, type TransferAdapter } from '@jalsoedesign/dockline-abstract';
import type { StatEntry, FileContents, AdapterListOptions, WriteOptions, MiscellaneousOptions, CreateDirectoryOptions, CopyFileOptions, MoveFileOptions, PublicUrlOptions, TemporaryUrlOptions, ChecksumOptions, MimeTypeOptions } from '@flystorage/file-storage';
import { type ConnectorOperationOptions, type TransferContents, type ConnectionStateEvent, type ConnectorCapabilities, type PublishFileOptions, type PublicationResult, type ChecksumDetailsOptions, type ChecksumResult, type CopyStrategyOptions, type CopyResult, walk as walkEntries, type WalkOptions } from '@jalsoedesign/dockline-abstract';
export type { FtpConnectorConfig } from '@jalsoedesign/dockline-abstract';
type FtpOptions<T = MiscellaneousOptions> = T & ConnectorOperationOptions;
/** A factory explicitly permits replay of an overwriting upload with a fresh stream. */
export type FtpUploadSource = TransferContents;
export declare class FtpConnector implements TransferAdapter {
    #private;
    private readonly config;
    private client;
    private needsNewClient;
    private connected;
    private hasConnected;
    private connectionPromise?;
    private generation;
    private disconnectGeneration;
    private queue;
    private cancelActive?;
    private readonly filenameEncoding;
    private keepaliveTimer?;
    private pendingOperations;
    private missedKeepalives;
    private lastAttempt;
    private currentState;
    constructor(config: FtpConnectorConfig);
    private createClient;
    get connectionState(): ConnectionStateEvent['state'];
    private transition;
    private clearKeepalive;
    private scheduleKeepalive;
    private probeKeepalive;
    private invalidate;
    disconnect(): Promise<void>;
    connect(options?: ConnectorOperationOptions): Promise<void>;
    private ensureConnected;
    private execute;
    private wrapError;
    write(path: string, contents: FtpUploadSource, options: FtpOptions<WriteOptions>): Promise<void>;
    read(path: string, options: FtpOptions): Promise<FileContents>;
    deleteFile(path: string, options: FtpOptions): Promise<void>;
    createDirectory(path: string, options: FtpOptions<CreateDirectoryOptions>): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: ConnectorOperationOptions & {
        overwrite: 'fail' | 'replace';
        requireAtomicRename?: boolean;
    }): Promise<{
        atomic: boolean;
    }>;
    serverFeatures(options?: ConnectorOperationOptions): Promise<readonly string[]>;
    serverChecksum(path: string, algorithm: 'sha256' | 'sha512', options?: ConnectorOperationOptions): Promise<string>;
    deleteDirectory(path: string, options: FtpOptions): Promise<void>;
    fileExists(path: string, options: FtpOptions): Promise<boolean>;
    directoryExists(path: string, options: FtpOptions): Promise<boolean>;
    private entryInfo;
    list(path: string, options: FtpOptions<AdapterListOptions>): AsyncGenerator<StatEntry>;
    moveFile(from: string, to: string, options: FtpOptions<MoveFileOptions>): Promise<void>;
    capabilities(options?: ConnectorOperationOptions & {
        negotiate?: boolean;
    }): Promise<ConnectorCapabilities>;
    publishFile(destination: string, contents: FtpUploadSource, options?: PublishFileOptions): Promise<PublicationResult>;
    validatePublicationOptions(options: PublishFileOptions): void;
    copyFileWithStrategy(from: string, to: string, options?: CopyStrategyOptions): Promise<CopyResult>;
    copyFile(from: string, to: string, options: FtpOptions<CopyFileOptions> & CopyStrategyOptions): Promise<void>;
    checksumDetails(path: string, options?: ChecksumDetailsOptions): Promise<ChecksumResult>;
    walk(path: string, options?: WalkOptions): ReturnType<typeof walkEntries>;
    stat(path: string, options: FtpOptions): Promise<StatEntry>;
    changeVisibility(_path: string, _visibility: string, _options: FtpOptions): Promise<void>;
    visibility(_path: string, _options: FtpOptions): Promise<string>;
    publicUrl(_path: string, _options: FtpOptions<PublicUrlOptions>): Promise<string>;
    temporaryUrl(_path: string, _options: FtpOptions<TemporaryUrlOptions>): Promise<string>;
    checksum(path: string, options: FtpOptions<ChecksumOptions> & ChecksumDetailsOptions): Promise<string>;
    mimeType(_path: string, _options: FtpOptions<MimeTypeOptions>): Promise<string>;
    lastModified(path: string, options: FtpOptions): Promise<number>;
    fileSize(path: string, options: FtpOptions): Promise<number>;
    static _wrapErrorForTest(error: unknown, password?: string): unknown;
}
```

### errors.d.ts

```ts
export { ConnectorError, AuthError, NotFoundError, PermissionError, UnsupportedProtocolError, NotSupportedError, OperationAbortedError, OperationTimeoutError, ConnectionClosedError } from '@jalsoedesign/dockline-abstract';
export { NameResolutionError, ConnectionRefusedError, TlsTrustError, CredentialProviderError, DirectoryAccessError } from '@jalsoedesign/dockline-abstract';
```

### filename-encoding.d.ts

```ts
import type { FtpFilenameEncoding, FtpFilenameEncodingOptions } from '@jalsoedesign/dockline-abstract';
export type { FtpFilenameEncoding, FtpFilenameEncodingOptions } from '@jalsoedesign/dockline-abstract';
export declare function resolveFilenameEncoding(options?: FtpFilenameEncodingOptions): FtpFilenameEncoding;
export declare function validateFilename(value: string, encoding: FtpFilenameEncoding): void;
```

### createConnector.d.ts

```ts
import { type FtpTransferConfig } from '@jalsoedesign/dockline-abstract';
import { FtpConnector } from './FtpConnector.js';
/** Create an FTP/FTPS adapter without opening a connection. */
export declare function createConnector(config: FtpTransferConfig): FtpConnector;
```

## @jalsoedesign/dockline-keys

### index.d.ts

```ts
import type { KeyInfo, KeyInput, KeyReadOptions, PrivateKeyExportOptions, PublicKeyExportOptions } from './types.js';
export { SshPrivateKeyError } from './errors.js';
export type { PrivateKeyFailure } from './errors.js';
export type * from './types.js';
export declare function inspectKey(input: KeyInput, options?: KeyReadOptions): Promise<KeyInfo>;
export declare function fingerprintKey(input: KeyInput, options?: KeyReadOptions): Promise<string>;
export declare function convertPrivateKey(input: KeyInput, options: PrivateKeyExportOptions): Promise<Buffer>;
export declare function convertPublicKey(input: KeyInput, options: PublicKeyExportOptions): Promise<Buffer>;
/** Normalize any supported private format for SSH transport without writing key files. */
export declare function preparePrivateKey(key: KeyInput | undefined, passphrase?: string | Buffer): Promise<Buffer | undefined>;
/** Compatibility API: convert PPK v3 only and retain pass-through identity for all other inputs. */
export declare function prepareSshPrivateKey(key: KeyInput | undefined, passphrase?: string | Buffer): Promise<KeyInput | undefined>;
```

### errors.d.ts

```ts
import { CredentialProviderError } from '@jalsoedesign/dockline-abstract';
export type PrivateKeyFailure = 'passphrase-required' | 'integrity' | 'format' | 'unsupported' | 'resource-limit';
export declare class SshPrivateKeyError extends CredentialProviderError {
    readonly reason: PrivateKeyFailure;
    constructor(reason: PrivateKeyFailure, message: string);
}
```

### types.d.ts

```ts
export type KeyInput = string | Buffer;
export type PrivateKeyFormat = 'openssh' | 'ppk' | 'pkcs8' | 'pem' | 'pkcs1' | 'sec1';
export type PublicKeyFormat = 'openssh' | 'rfc4716' | 'spki' | 'pkcs1';
export interface KeyReadOptions {
    inputPassphrase?: string | Buffer;
}
export interface PpkDerivationOptions {
    memoryKiB?: number;
    passes?: number;
    parallelism?: number;
}
export interface PrivateKeyExportOptions extends KeyReadOptions {
    format: PrivateKeyFormat;
    outputPassphrase?: string | Buffer;
    ppkVersion?: 2 | 3;
    comment?: string;
    argon2?: PpkDerivationOptions;
}
export interface PublicKeyExportOptions extends KeyReadOptions {
    format: PublicKeyFormat;
    comment?: string;
}
export interface KeyInfo {
    kind: 'private' | 'public';
    format: PrivateKeyFormat | PublicKeyFormat;
    algorithm: 'rsa' | 'dsa' | 'ecdsa' | 'ed25519';
    bits: number;
    encrypted: boolean;
    comment: string;
    fingerprint: string;
    ppkVersion?: 2 | 3;
}
```

## @jalsoedesign/dockline-sftp-client

### index.d.ts

```ts
export { SftpConnector } from './SftpConnector.js';
export { KnownHostsStore, KnownHostsConflictError } from './KnownHostsStore.js';
export type { KnownHostsStoreOptions, KnownHostEntry, KnownHostInspection, KnownHostApproval } from './KnownHostsStore.js';
export * from './errors.js';
export type { SftpConnectorConfig, SftpHostKeyChallenge, SftpTrustPolicy, SftpHostVerifier, SftpKeyboardInteractive, SftpKeyboardInteractiveChallenge, } from './SftpConnector.js';
export type { ConnectorOperationOptions } from '@jalsoedesign/dockline-abstract';
export { createConnector } from './createConnector.js';
export type { SftpTransferConfig, TransferAdapter } from '@jalsoedesign/dockline-abstract';
export { prepareSshPrivateKey, SshPrivateKeyError } from './PrivateKey.js';
export type { PrivateKeyFailure } from './PrivateKey.js';
```

### SftpConnector.d.ts

```ts
import { type SftpConnectorConfig, type TransferAdapter } from '@jalsoedesign/dockline-abstract';
import type { StatEntry, FileContents, AdapterListOptions, WriteOptions, MiscellaneousOptions, CreateDirectoryOptions, CopyFileOptions, MoveFileOptions, PublicUrlOptions, TemporaryUrlOptions, ChecksumOptions, MimeTypeOptions } from '@flystorage/file-storage';
import { type PublishFileOptions, type ChecksumDetailsOptions, type CopyStrategyOptions, type CopyResult, type WalkOptions, type ConnectorOperationOptions, type TransferContents } from '@jalsoedesign/dockline-abstract';
export type { SftpConnectorConfig, SftpHostKeyChallenge, SftpTrustPolicy, SftpHostVerifier, SftpKeyboardInteractive, SftpKeyboardInteractiveChallenge, } from '@jalsoedesign/dockline-abstract';
type OperationOptions<T> = T & ConnectorOperationOptions;
export declare class SftpConnector implements TransferAdapter {
    private readonly config;
    private client;
    private clientUsed;
    private connected;
    private connectionLost;
    private connecting?;
    private disconnectGeneration;
    private previousFingerprint?;
    private everConnected;
    private state;
    private readonly secrets;
    private readonly active;
    constructor(config: SftpConnectorConfig);
    private emitState;
    private createClient;
    private connectionFailed;
    private invalidate;
    private closeClient;
    connect(options?: ConnectorOperationOptions): Promise<void>;
    private waitForConnection;
    private establishConnection;
    private authenticationForAttempt;
    private answerChallenges;
    private verifyHostKey;
    disconnect(): Promise<void>;
    private ensureConnected;
    private checkAborted;
    private withAttempt;
    private run;
    private wrapPath;
    private wrapError;
    write(path: string, contents: TransferContents, options?: OperationOptions<WriteOptions>): Promise<void>;
    read(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<FileContents>;
    deleteFile(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<void>;
    createDirectory(path: string, options?: OperationOptions<CreateDirectoryOptions>): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: ConnectorOperationOptions & {
        overwrite: 'fail' | 'replace';
        requireAtomicRename?: boolean;
    }): Promise<{
        atomic: boolean;
    }>;
    serverFeatures(options?: ConnectorOperationOptions): Promise<readonly string[]>;
    deleteDirectory(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<void>;
    fileExists(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<boolean>;
    directoryExists(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<boolean>;
    list(path: string, options?: OperationOptions<AdapterListOptions>): AsyncGenerator<StatEntry>;
    moveFile(from: string, to: string, options?: OperationOptions<MoveFileOptions>): Promise<void>;
    copyFile(from: string, to: string, options?: OperationOptions<CopyFileOptions> & CopyStrategyOptions): Promise<void>;
    copyFileWithStrategy(from: string, to: string, options?: CopyStrategyOptions): Promise<CopyResult>;
    validatePublicationOptions(options: PublishFileOptions): void;
    publishFile(path: string, contents: TransferContents, options?: PublishFileOptions): Promise<import("@jalsoedesign/dockline-abstract").PublicationResult>;
    checksumDetails(path: string, options?: ChecksumDetailsOptions): Promise<import("@jalsoedesign/dockline-abstract").ChecksumResult>;
    walk(path: string, options?: WalkOptions): {
        entries: AsyncGenerator<StatEntry>;
        result: Promise<import("@jalsoedesign/dockline-abstract").WalkResult>;
    };
    capabilities(options?: ConnectorOperationOptions & {
        negotiate?: boolean;
    }): Promise<import("@jalsoedesign/dockline-abstract").ConnectorCapabilities>;
    stat(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<StatEntry>;
    changeVisibility(_path: string, _visibility: string, _options?: OperationOptions<MiscellaneousOptions>): Promise<void>;
    visibility(_path: string, _options?: OperationOptions<MiscellaneousOptions>): Promise<string>;
    publicUrl(_path: string, _options?: OperationOptions<PublicUrlOptions>): Promise<string>;
    temporaryUrl(_path: string, _options: OperationOptions<TemporaryUrlOptions>): Promise<string>;
    checksum(path: string, options?: OperationOptions<ChecksumOptions> & ChecksumDetailsOptions): Promise<string>;
    mimeType(_path: string, _options?: OperationOptions<MimeTypeOptions>): Promise<string>;
    lastModified(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<number>;
    fileSize(path: string, options?: OperationOptions<MiscellaneousOptions>): Promise<number>;
    static _wrapErrorForTest(error: unknown, config?: Partial<SftpConnectorConfig>): Error;
}
```

### KnownHostsStore.d.ts

```ts
import { HostTrustError } from '@jalsoedesign/dockline-abstract';
import type { SftpHostKeyChallenge, SftpTrustPolicy } from './SftpConnector.js';
export interface KnownHostsStoreOptions {
    file: string;
    /** Competing writers wait this long; abandoned locks are never silently stolen. */
    lockTimeoutMs?: number;
}
export interface KnownHostEntry {
    readonly host: string;
    readonly port: number;
    readonly keyType: string;
    readonly publicKey: string;
    readonly fingerprint: string;
}
export interface KnownHostInspection {
    readonly status: 'unknown' | 'match' | 'changed';
    readonly previousFingerprint: string | null;
}
export interface KnownHostApproval {
    approved: true;
    /** Value returned by inspect() before asking for approval; null means unknown. */
    previousFingerprint: string | null;
}
export declare class KnownHostsConflictError extends HostTrustError {
    constructor();
}
/** Explicitly selected, versioned JSON trust store. Never discovers or edits external client trust files. */
export declare class KnownHostsStore {
    private readonly file;
    private readonly lockTimeoutMs;
    private constructor();
    static open(options: KnownHostsStoreOptions): Promise<KnownHostsStore>;
    private readEntries;
    inspect(challenge: SftpHostKeyChallenge): Promise<KnownHostInspection>;
    readonly matches: SftpTrustPolicy;
    readonly hasTrustPolicy: SftpTrustPolicy;
    /** Public-key data only; useful for explicit export/review. */
    entries(): Promise<readonly KnownHostEntry[]>;
    recordAccepted(challenge: SftpHostKeyChallenge, approval: KnownHostApproval): Promise<void>;
    /** Adds persisted changed-key metadata before asking the application's CLI or UI. */
    trustPolicy(approve: SftpTrustPolicy): {
        requireTrustPolicy: true;
        hasTrustPolicy: SftpTrustPolicy;
        acceptTrustPolicy: SftpTrustPolicy;
    };
}
```

### errors.d.ts

```ts
export { ConnectorError, AuthError, NotFoundError, PermissionError, UnsupportedProtocolError, NotSupportedError, HostTrustError, OperationAbortedError, OperationTimeoutError, ConnectionClosedError, NameResolutionError, ConnectionRefusedError, CredentialProviderError, DirectoryAccessError, } from '@jalsoedesign/dockline-abstract';
/** @deprecated Authentication failures share AuthError across all connectors. */
export { AuthError as KeyAuthError } from '@jalsoedesign/dockline-abstract';
```

### createConnector.d.ts

```ts
import { type SftpTransferConfig } from '@jalsoedesign/dockline-abstract';
import { SftpConnector } from './SftpConnector.js';
/** Create an SFTP adapter without opening a connection. */
export declare function createConnector(config: SftpTransferConfig): SftpConnector;
```

### PrivateKey.d.ts

```ts
export { prepareSshPrivateKey, SshPrivateKeyError } from '@jalsoedesign/dockline-keys';
export type { PrivateKeyFailure } from '@jalsoedesign/dockline-keys';
```

## @jalsoedesign/dockline-ssh-client

### index.d.ts

```ts
export { SshClient, SshSession, quotePosix } from './SshClient.js';
export type { ResolvedSsh, SshServices, ExecOptions, ExecResult, FileTransfer } from './SshClient.js';
export type { SshOptions, Question } from './types.js';
```

### SshClient.d.ts

```ts
import ssh2 from 'ssh2';
import { type SshOptions, type Question } from './types.js';
export interface ResolvedSsh extends SshOptions {
    host: string;
    port: number;
    username: string;
    password?: string;
    passphrase?: string;
}
export interface ExecOptions {
    timeout?: string | number;
    sudo?: boolean | string;
    allowFailure?: boolean;
}
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface FileTransfer {
    sourceFile: string;
    destinationFile: string;
    timeout?: string | number;
    maxBytes?: number;
}
export interface SshServices {
    resolve(options: SshOptions): Promise<ResolvedSsh>;
    ask(question: Question): Promise<string | boolean>;
    trust(host: string, port: number, fingerprint: string): Promise<boolean>;
    log(message: string): void;
    signal: AbortSignal;
    directory: string;
}
export declare function quotePosix(value: string): string;
export declare class SshSession {
    private readonly client;
    private readonly config;
    private readonly services;
    private readonly user?;
    private readonly credentials;
    constructor(client: ssh2.Client, config: ResolvedSsh, services: SshServices, user?: string | undefined, credentials?: {
        sudoPassword?: string;
    });
    asUser<T>(user: string, callback: (session: SshSession) => Promise<T>): Promise<T>;
    exec(program: string, args?: string[], options?: ExecOptions): Promise<ExecResult>;
    shell(command: string, options?: ExecOptions): Promise<ExecResult>;
    private execute;
    private transfer;
    download(options: FileTransfer): Promise<void>;
    upload(options: FileTransfer): Promise<void>;
}
export declare class SshClient {
    private readonly services;
    constructor(config: ResolvedSsh, options?: Partial<Omit<SshServices, 'resolve'>>);
    withConnection<T>(callback: (server: SshSession) => Promise<T>): Promise<T>;
    withConnection<T>(options: SshOptions, callback: (server: SshSession) => Promise<T>): Promise<T>;
}
```

### types.d.ts

```ts
export interface SshOptions {
    password?: string;
    passphrase?: string;
    host?: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    agent?: string;
    keyboardInteractive?: boolean;
    hostFingerprint?: string;
    sudo?: {
        password?: 'prompt' | 'none';
        passwordEnv?: string;
    };
}
export interface Question {
    id: string;
    message: string;
    type: 'password' | 'input';
    required?: boolean;
}
export declare function milliseconds(value: string | number): number;
```
