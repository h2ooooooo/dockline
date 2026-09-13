# Public API

This catalogue describes the `@dockline/*` packages. The generated declarations are the authority for exact TypeScript overloads. Start with [Quick start FTP](../ftp/quick-start.md) or [Quick start SFTP](../sftp/quick-start.md) for complete configuration and file-transfer examples.

## Package entry points

| Import | Exports |
| --- | --- |
| `@dockline/core` | `Dockline`, SDK file helpers/options, configuration-based client selection, `MissingClientPackageError` and the generic abstract API. |
| `@dockline/abstract` | Shared configuration/adapter types, errors, connection/operation types, progress, bandwidth, publication/checksum/copy/walk helpers, capabilities and pools. |
| `@dockline/ftp-client` | `FtpConnector`, `createConnector(FtpTransferConfig)`, low-level/common FTP configuration, filename helpers and relevant shared exports. |
| `@dockline/sftp-client` | `SftpConnector`, `createConnector(SftpTransferConfig)`, SFTP configuration/authentication/trust types, managed known hosts and relevant shared exports. |
| `@dockline/cli` | Embeddable command runner/program, YAML loader and CLI context/config types; also installs the `dockline` executable. |
| Each package's `/package.json` | Metadata for that package. |

Core depends only on abstract and declares the two clients as optional peers. Install the selected client explicitly. Core does not re-export concrete clients, `KnownHostsStore` or old `/ftp`, `/sftp`, `/core` subpaths. Use [package entry points](/guide/packages) instead of generated implementation paths.

Shared constructors originate in abstract. Re-exports share their identity when packages resolve one installed abstract copy; separately installed copies have ordinary JavaScript class-identity differences.

## Dockline configuration and construction

| Export | Contract |
| --- | --- |
| `TransferConfig` | Discriminated union of `FtpTransferConfig` and `SftpTransferConfig`, defined in abstract and re-exported by core. |
| `TransferProtocol` | `'ftp' \| 'ftps' \| 'ftps-implicit' \| 'sftp'`. `ftps` means explicit TLS. |
| `FtpTransferConfig` | Common `protocol`, `host`, `username`, optional `port`, `password`, `root`, `passive`, plus FTP operation, connection, TLS and filename options. |
| `SftpTransferConfig` | `protocol: 'sftp'`, host/username, optional port/root and SFTP authentication, trust, operation and connection options. |
| `TransferAdapter` | Structural shared storage, transfer and lifecycle interface from abstract; it does not import either concrete client. |
| Core `createConnector(config)` | Validate common configuration and synchronously return the selected installed client's adapter without opening a connection. |
| Client `createConnector(config)` | Map that client's common configuration and return a concrete lazy `FtpConnector` or `SftpConnector`; core is not required. |
| `validateTransferConfig(config)` | Shared validation without loading a transport; returns resolved `{port, root}`. |
| `relativeRemotePath(value, allowRoot = false)` | Validate/normalize SDK relative paths; root-capable operations use `true`. |

Default ports are 21 for FTP/explicit FTPS, 990 for implicit FTPS and 22 for SFTP. SDK remote arguments use forward slashes relative to `root`. They reject absolute paths, drive prefixes, `..`, control characters, backslashes and invalid Unicode. Empty or dot paths are accepted only by root-capable operations. A configured root is a path convention, not protection against server-side symlinks or concurrent changes.

| Constructor/static method | Result and ownership |
| --- | --- |
| `new Dockline(config)` / `Dockline.create(config)` | Synchronously select the installed client and create a session wrapper without connecting. |
| `Dockline.connect(config)` | `Promise<Dockline>` with an authenticated connection; caller must disconnect. Failed connection attempts are cleaned up. |
| `Dockline.withConnection(config, async remote => result)` | `Promise<T>`; connect, await callback, then disconnect on success or failure. |
| `Dockline.createPool(config, options = {})` | `ConnectorPool<Dockline>`; each lease owns a separate wrapper/session. Options are `PoolOptions<Dockline>` without `create`. |

An absent selected client causes `MissingClientPackageError`, with code `DOCKLINE_CLIENT_NOT_INSTALLED` and fields `protocol`, `packageName` and `installCommand`. It extends `ConnectorError`. Synchronous constructors throw it; asynchronous connection helpers reject with it. A broken installed client's original error propagates. Dockline never installs a client or substitutes another protocol. See [client loading](/guide/packages#when-a-client-is-missing).

If both an operation and its cleanup fail, scoped connection helpers preserve both errors in an `AggregateError`. A cleanup failure after a successful callback is still reported. Consume returned streams and iterators inside the callback before its connection closes.


## Dockline instance methods

Every optional `options` argument defaults to `{}` except `rename`, which requires an explicit policy.

| Member | Arguments | Result / behavior |
| --- | --- | --- |
| `connector` | Readonly `TransferAdapter` property | Shared structural access to the advanced adapter; import a concrete client for protocol-specific types. |
| `connect` | `options?: ConnectorOperationOptions` | `Promise<void>`. |
| `disconnect` | None | `Promise<void>`; closes this session. |
| `list` | `remotePath = '.', options?: TransferListOptions` | Async iterator; shallow by default. |
| `stat` | `remotePath, options?` | Promise of file/directory metadata. Root is allowed. |
| `read` | `remotePath, options?` | `Promise<Readable>`; consume or destroy the stream. |
| `write` | `remotePath, string \| Buffer \| TransferContents, options?` | `Promise<void>`; direct remote overwrite. Strings/buffers are wrapped in fresh readable factories. |
| `uploadFile` | `localPath, remotePath, options?: UploadFileOptions` | `Promise<void>`; reads a regular local file and supplies a fresh stream per eligible attempt. |
| `downloadFile` | `remotePath, localPath, options?: DownloadFileOptions` | `Promise<void>`; local staging with an optional byte limit, full stream consumption, length check and explicit local publication. |
| `deleteFile` | `remotePath, options?` | `Promise<void>`; remove a file. |
| `createDirectory` | `remotePath, options?` | `Promise<void>`; create the remote directory. |
| `rename` | `from, to, options: RenameOptions` | `Promise<{atomic: boolean}>`; no silent weakening of the requested policy. |
| `publishFile` | `remotePath, contents: TransferContents, options?: PublishFileOptions` | `Promise<PublicationResult>`. |
| `checksumDetails` | `remotePath, options?: ChecksumDetailsOptions` | `Promise<ChecksumResult>`. |
| `copyFile` | `from, to, options?: CopyStrategyOptions` | `Promise<CopyResult>`; same-session client copy with an optional byte limit. |
| `walk` | `remotePath = '.', options?: WalkOptions` | `{entries: AsyncGenerator<StatEntry>, result: Promise<WalkResult>}`. |
| `capabilities` | `options?: ConnectorOperationOptions & {negotiate?: boolean}` | `Promise<ConnectorCapabilities>`; no network discovery unless requested. |
| `toJSON` | None | Protocol, host, port and root only; credentials are excluded. |

`UploadFileOptions` adds `overwrite: 'replace' | 'fail'`; its default is **replace**. Selecting `fail` uses checked publication and is unsupported by portable FTP before any file is uploaded. A direct replacement can leave partial remote changes if interrupted.

`DownloadFileOptions` adds `overwrite: 'replace' | 'fail'` and inherits `maxBytes` from the shared operation options. Overwrite defaults to **fail**, and download size is **unlimited** unless a connection or call supplies a byte limit. The parent local directory must exist. Fail-on-existing publication uses a hard link to the completed staged file and requires filesystem hard-link support. Replacement uses rename. Owned temporary content is cleaned up on success/failure; a cleanup error can occur after the destination has been published. Download completion is not a transactional snapshot of a concurrently changing remote file.

`TransferListOptions` adds `deep?: boolean`. SDK `list` defaults to shallow; use the bounded `walk` helper for explicit traversal budgets. Metadata types come from the storage-adapter dependency and describe file/directory paths, available size and modification time. Missing or unsupported values must not be inferred as success.

## Operation and connection options

| `ConnectorOperationOptions` field | Default / meaning |
| --- | --- |
| `autoReconnect` | `false`; opt-in reconnect after a closed established session. |
| `maxTransientRetries` | `3` additional eligible attempts after the first; not a blanket mutation replay. |
| `timeoutMs` | `30000` per attempt; zero disables that deadline. |
| `timeout` | Compatibility alias used when `timeoutMs` is absent. |
| `abortSignal` | Optional cancellation signal. |
| `onProgress` | Optional observer of immutable `TransferProgressEvent` values. |
| `totalBytes` | Optional non-negative size hint. |
| `maxBytes` | Optional per-transfer byte limit; unlimited by default. `undefined` inherits, `Infinity` removes an inherited limit, and zero allows only empty content. |
| `progressIntervalMs` | `100` when progress is observed. |
| `bandwidth` | Optional bytes/second number or shared `BandwidthBudget`. |

Per-call settings override connection defaults. A finite `maxBytes` must be a non-negative safe integer; invalid limits reject before transfer I/O. The limit applies to raw reads/writes, SDK uploads/downloads, streamed checksums and client-streamed copies. It is a limit for each transfer, not an aggregate connection quota. `ResolvedConnectorOperationOptions` contains the resolved reconnect, retry, deadline and signal fields. `resolveOperationOptions(defaults?, overrides?)` validates/resolves those fields. `isTransientError(error)` classifies eligible errors but does not establish that an operation is safe to replay.

`resolveByteLimit(value)` from abstract returns `Infinity` for `undefined` or `Infinity`, accepts a non-negative safe integer, and rejects other values with `RangeError`. It validates a supplied value; callers still resolve inheritance between connection and per-call settings.

`TransferSourceFactory` is `() => Readable | Promise<Readable>` and `TransferContents` is `Readable | TransferSourceFactory`. A consumed stream is not a replayable source. Authentication, trust, permissions, unsupported operations and explicit cancellation are not automatically retried.

`ConnectorConnectionOptions` adds `siteId?`, `credentialProvider?`, `keepalive?` and `onConnectionState?`. `siteId` is an opaque application label. `ConnectorProtocol` is `'ftp' | 'sftp'`; FTPS uses the FTP protocol family in events.

| Exported type | Shape / role |
| --- | --- |
| `CredentialContext` | Readonly optional site ID, host, port, protocol, connect/reconnect purpose, attempt and abort signal. |
| `ConnectorCredentials` | Explicit password, private-key or agent credential union, with optional username override. |
| `CredentialProvider` | Context → credentials or promise; called for connection authentication, not every file. |
| `KeepaliveOptions` | `intervalMs`, optional `maxMissed`. |
| `ConnectionStateEvent` | State `connecting`, `ready`, `disconnected`, `reconnecting` or `failed`; protocol, attempt and optional sanitized shared error. |

`emitConnectionState(callback, event)` safely emits a frozen event. `classifyConnectionError(error, stage)` preserves known shared errors and classifies recognized stages/codes; it is not a general sanitizer. Observer exceptions and rejected observer promises do not change confirmed transfer outcomes.

## Shared transfer helpers

The standalone functions take a connector as their first argument. Adapter methods and SDK methods delegate to them.

| Export | Contract |
| --- | --- |
| `TransferConnector` | Structural read/stat/list/delete/write, exclusive directory, empty-directory removal and rename contract, with optional server checksum. Publication policy validation is required. |
| `RenameOptions` | Required `overwrite: 'fail' \| 'replace'`, optional `requireAtomicRename`, plus operation options. |
| `checksumDetails(connector, path, options?)` | SHA-256/SHA-512 details; server-only default. |
| `ChecksumDetailsOptions` | `algorithm?`, strategy `server-only \| stream \| server-or-stream`, `maxBytes?`, operation options. |
| `ChecksumResult` | Readonly algorithm, actual server/stream strategy, hexadecimal digest and optional bytes read. |
| `publishFile(connector, destination, contents, options?)` | Owned sibling staging, optional verification, explicit final rename and recovery result. |
| `PublishFileOptions` | Overwrite policy, atomic requirement, optional `verify: {algorithm?, expectedDigest, maxBytes?}`, cleanup policy and operation options. |
| `PublicationResult` | Destination, actual atomic/verified flags, cleanup `done \| failed` and optional retained temporary path. |
| `copyFileWithStrategy(connector, from, to, options?)` | Local spool with an optional byte limit, then publication through the same connection. |
| `CopyStrategyOptions` | Publication options plus `strategy: auto \| client-streamed \| server-native`, byte limit and optional `onStrategy`. |
| `CopyResult` | Actual `client-streamed` strategy, bytes copied and publication result. Server-native is currently unsupported. |
| `walk(connector, root, options?)` | Async entries and a separate completion result. |
| `WalkOptions` | `maxDepth`, `maxEntries`, optional asynchronous filter and operation options. Defaults: 32 / 100,000 examined entries. |
| `WalkResult` | Readonly complete flag, examined entry count and reason: complete, depth/entry budget, cancelled, consumer-stopped or failed. |
| `checkAbort(signal?)` | Throw `OperationAbortedError` if already cancelled. |
| `toReadable(contents)` | Normalize supported storage content to a Node readable. |

Streamed hashes/copies are unlimited unless `maxBytes` is explicitly configured on the connector or call. Nested `verify.maxBytes` overrides the publication limit when supplied; `undefined` inherits it, and `Infinity` removes it for verification. Publication defaults to fail-on-existing. FTP requires explicit replacement and cannot promise portable atomic rename. SFTP replacement uses the POSIX rename extension when available; unsupported guarantees reject explicitly. Read [advanced transfers](../guide/advanced-transfers.md) before selecting policy or recovering an uncertain rename.

## Progress, bandwidth and capabilities

`TransferDirection` is `'upload' | 'download'`. `TransferProgressEvent` includes direction, optional path, one-based attempt, stage, bytes transferred, optional total, elapsed milliseconds and average bytes per second. Stages are starting/transferring/completed/failed/cancelled. Completion describes the connector operation; local download publication happens afterward.

`new BandwidthBudget({bytesPerSecond, burstBytes?})` exposes readonly limits and `consume(bytes, signal?, direction = 'upload')`. A shared budget accounts for uploads and downloads separately. It limits average throughput; source chunks can still produce bursts. `createTransferMonitor(options, direction, attempt, path?)` returns `TransferMonitor` with a transform `stream`, `complete()`, `fail(error?)` and `dispose()`. Adapter authors must report completion only after protocol completion and consumption.

`describeCapabilities(protocol, features?)` constructs a `ConnectorCapabilities` report from verified-session information; it does not connect. `SupportState` is supported/unsupported/unknown. `Capability` carries state plus optional condition and algorithms. `ConnectorCapabilities` contains schema version 1, protocol, separate adapter/server maps, negotiation flag, inventory status and feature strings. Inventory is not-requested/advertised/unavailable. Unknown server support is not permission to assume a guarantee.

## Connection pools

`ConnectorPool<T extends PoolConnection>` accepts `PoolOptions<T>` with required `create({abortSignal})`, optional `maxConnections`, `serverMaxConnections` and `idleTimeoutMs`. Default maximum is three; a positive server ceiling can lower it. `PoolConnection` requires `connect(options?)` and `disconnect()`.

| Member | Contract |
| --- | --- |
| `maxConnections` | Effective readonly limit. |
| `stats` | Readonly `limit`, `connections`, `active` and `queued` counts. |
| `acquire(options?)` | `Promise<ConnectionLease<T>>`; FIFO acquisition with cancellation/deadline support. |
| `withConnection(callback, options?)` | Acquire, await callback and release with resource tracking. |
| `close({force?, timeoutMs?} = {})` | Stop new acquisition, finish/revoke leases and close transports. Default close deadline: 30 seconds. |

`ConnectionLease<T>` exposes a tracked `connector` and idempotent async `release()`. Returned streams and iterators keep a slot occupied until finished. Regular directory and metadata calls count too. Do not keep using a connector after its lease is released or revoked. See [pools](../guide/pools.md) for graceful/forced close and cancellation boundaries.

## Direct FTP and SFTP adapters

Import concrete adapters and their factories from `@dockline/ftp-client` or `@dockline/sftp-client`. Neither client requires core or the other client. The common config types are defined in abstract and re-exported by the appropriate client.

`FtpConnectorConfig` uses `host`, required `port`, `user`, `password`, `secure: boolean | 'implicit'`, `initialPath`, `passive`, optional `secureOptions` and `filenameEncoding`, plus shared connection/operation fields. `FtpUploadSource` aliases `TransferContents`.

`SftpConnectorConfig` uses `host`, required `port`, `username`, `initialPath`; optional password, privateKey, privateKeyPath, passphrase, agent, keyboardInteractive, UTF-8 filename settings, hostVerifier, readyTimeout and explicit trust hooks. `agentForward` only accepts false. See [FTP](../guide/ftp.md) and [SFTP](../guide/sftp.md) for full configuration and supported combinations.

Both adapters expose connect/disconnect, read/write, shallow/deep list, stat, fileExists/directoryExists, createDirectory/deleteDirectory/deleteFile, fileSize/lastModified, moveFile, renameFile, exclusive directory creation, empty-directory removal, publication policy validation, publication/copy/checksum/walk helpers, capabilities and serverFeatures. The direct `deleteDirectory` operation is recursive; the ordinary SDK deliberately exposes file deletion only. Direct adapter paths use their `initialPath` behavior and are not the SDK's relative-path validator.

| Adapter member | Distinction |
| --- | --- |
| `copyFile` | Compatibility `Promise<void>`; use `copyFileWithStrategy` for `CopyResult`. SDK `Dockline.copyFile` already returns that result. |
| `moveFile` | Compatibility rename; use `renameFile` for explicit overwrite/atomic policy. |
| `checksum` | Compatibility string result with supported algorithm/encoding options; use `checksumDetails` for actual strategy metadata. |
| FTP `serverChecksum` | Verified advertised SHA-256/SHA-512 HASH support. No SFTP equivalent is implemented. |
| `changeVisibility`, `visibility`, `publicUrl`, `temporaryUrl`, `mimeType` | Interface methods that reject as unsupported. |

Metadata operations can expose dependency limitations; see [errors](../guide/errors.md#dependency-boundaries). A configured root and existence result alone cannot establish safe destructive synchronization.

FTP also exports `FtpFilenameEncodingOptions`, `FtpFilenameEncoding`, `resolveFilenameEncoding(options?)` and `validateFilename(value, encoding)`. Supported normalized names are utf8, ascii and latin1; ISO-8859-1 maps to latin1. Unsupported/lossy names reject. File content is never transcoded by filename encoding.

## SFTP trust and managed known hosts

Common authentication/trust contracts are defined in abstract and re-exported through core and the SFTP client. `KnownHostsStore`, its storage-specific types and `KnownHostsConflictError` are exported only by `@dockline/sftp-client`.

| Export | Contract |
| --- | --- |
| `SftpHostKeyChallenge` | Host, port, key type, fingerprint, public-key bytes, optional previous fingerprint, changed flag and abort signal. |
| `SftpTrustPolicy` | Challenge → boolean or promise. |
| `SftpHostVerifier` | Raw-key boolean/promise function or callback verifier. |
| `SftpKeyboardInteractiveChallenge` | Name, instructions, language, readonly prompt/echo list and abort signal. |
| `SftpKeyboardInteractive` | String for one prompt, or callback returning the ordered response array, synchronously or asynchronously. |
| `KnownHostsStoreOptions` | `file` and optional `lockTimeoutMs`. |
| `KnownHostEntry` | Readonly host, port, keyType, serialized publicKey and fingerprint. |
| `KnownHostInspection` | `status: unknown \| match \| changed` and previous fingerprint or null. |
| `KnownHostApproval` | Explicit `approved: true` and previously inspected fingerprint or null. |

`KnownHostsStore.open(options)` opens/validates the versioned JSON store. Instances expose `inspect(challenge)`, `matches(challenge)`, `hasTrustPolicy` (alias), `entries()`, `recordAccepted(challenge, approval)` and `trustPolicy(approve)`. The last returns the required-policy flag and both application trust hooks. It persists only explicit acceptance, checks competing updates and does not silently replace changed keys. `KnownHostsConflictError` signals stale approval.

Selecting `requireTrustPolicy: true` requires both `hasTrustPolicy` and `acceptTrustPolicy`. Prompts and policy decisions belong to the application. See [trust](../guide/trust.md) for secure examples and persistence semantics.

## Error exports

`@dockline/abstract` and its core re-exports provide `ConnectionStage`, `ConnectorError`, `AuthError`, `NotFoundError`, `PermissionError`, `UnsupportedProtocolError`, `NotSupportedError`, `OperationAbortedError`, `OperationTimeoutError`, `ConnectionClosedError`, `HostTrustError`, `NameResolutionError`, `ConnectionRefusedError`, `TlsTrustError`, `CredentialProviderError`, `DirectoryAccessError`, `ResourceLimitError`, `IntegrityError`, `PoolClosedError` and `PublicationError`.

`@dockline/sftp-client` adds `KnownHostsConflictError` and deprecated `KeyAuthError`, an alias of `AuthError`. Clients re-export relevant shared errors; import abstract or core for the complete shared hierarchy. Core additionally exports `MissingClientPackageError`; that loader-specific error is not exported by abstract. Configuration/local filesystem failures can retain `TypeError`, `RangeError`, native errors or `AggregateError`. The [error guide](../guide/errors.md) documents stable fields, causes, recovery state and the limits of classification.

## CLI package API

The optional `@dockline/cli` package exports `runCli(argv?: readonly string[], context?: CliContext): Promise<number>`, `createProgram(context?: CliContext)`, `loadCliConfig(filename, options?)`, and its CLI context/configuration types. The runner returns an exit code after cleanup rather than forcing the host process to exit. Commander/YAML behavior and terminal host approval stay in this package; the core SDK does not depend on it. See [embedding and SDK integration](/guide/cli-integration#embed-the-packaged-cli), [commands](/cli/commands) and [YAML configuration](/cli/configuration).

The CLI also exports `resolveCliCommandDefaults`, `CliConfigError`, `CliUsageError` and the types `CliCommand`, `CliCommandOptions`, `CliCommandDefaults`, `CliTrustConfig`, `LoadedCliConfig`, `CliContext` and `CliResult`. `CliResult` describes successful command results; the runner separately formats failures with error code/message. The [embedding table](/guide/cli-integration#embed-the-packaged-cli) documents these contracts.
