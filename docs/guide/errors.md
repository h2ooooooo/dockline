# Error reference

Import shared connector errors from `@jalsoedesign/dockline-abstract` or its re-exports in `@jalsoedesign/dockline-core`. Both clients re-export relevant shared constructors. These identities agree when the packages resolve the same installed abstract copy. Multiple separately installed copies can have ordinary JavaScript class-identity differences. Core's missing-client error and the SFTP known-hosts conflict subclass are described separately below.

## Missing protocol client

Import `MissingClientPackageError` from `@jalsoedesign/dockline-core`. It extends `ConnectorError`, has code `DOCKLINE_CLIENT_NOT_INSTALLED`, and exposes `protocol`, `packageName` and `installCommand`. Synchronous construction throws it when the selected optional client is absent; asynchronous connection helpers reject with it.

Install the matching client explicitly using the [installation guide](/guide/installation). Dockline does not run the suggested command or change protocols. Errors from a present but broken client keep their original identity. This loader-specific error is not exported by abstract.

## Shared hierarchy

| Class | Parent | Meaning and stable fields |
| --- | --- | --- |
| `ConnectorError` | Error | Base with optional `cause`, `code` and `stage`. |
| `AuthError` | ConnectorError | Authentication rejected; stage `authenticate`. |
| `CredentialProviderError` | AuthError | Provider failed; stage `credentials`, code `CREDENTIAL_PROVIDER_FAILED`. |
| `HostTrustError` | ConnectorError | Host identity rejected; stage `trust`, code `HOST_TRUST_REJECTED`. |
| `TlsTrustError` | HostTrustError | TLS certificate trust failed; inherits the host-trust stage and code. |
| `NameResolutionError` | ConnectorError | DNS failure; stage `resolve`, default code `ENOTFOUND`; the classifier preserves `EAI_AGAIN`. |
| `ConnectionRefusedError` | ConnectorError | Connection refused; stage `connect`, code `ECONNREFUSED`. |
| `DirectoryAccessError` | ConnectorError | Initial-directory setup failed; stage `directory`, optional underlying status code. |
| `NotFoundError` | ConnectorError | Confirmed missing resource where the dependency preserves that distinction; see the dependency boundaries below. |
| `PermissionError` | ConnectorError | Requested access was denied. |
| `UnsupportedProtocolError` | ConnectorError | No connector supports the selected protocol. |
| `NotSupportedError` | ConnectorError | Unsupported operation, strategy, option or protocol guarantee. |
| `OperationAbortedError` | ConnectorError | Cancellation; code `ABORT_ERR`. |
| `OperationTimeoutError` | ConnectorError | Deadline expired; code `ETIMEDOUT`. |
| `ConnectionClosedError` | ConnectorError | Session closed; code `ECONNRESET`. |
| `ResourceLimitError` | ConnectorError | An explicitly configured transfer/checksum/copy byte budget was exceeded. |
| `IntegrityError` | ConnectorError | Digest, full-file hash response or observed file-size verification failed. |
| `PoolClosedError` | ConnectorError | Acquisition/use is incompatible with a closed pool or revoked lease. |
| `PublicationError` | ConnectorError | Composed publication failed; inspect the explicit remote `state` before recovery. |

`ConnectionStage` is `'resolve' | 'connect' | 'trust' | 'authenticate' | 'directory' | 'credentials' | 'ready'`. It is optional when the transport cannot identify a stage. Catch specific subclasses before their parents. SFTP's deprecated `KeyAuthError` is an alias of `AuthError`.

## Constructors and causes

The base signature is:

`new ConnectorError(message, cause?, code?, stage?)`

`AuthError`, `NotFoundError`, `PermissionError`, `UnsupportedProtocolError`, `NotSupportedError`, `ResourceLimitError`, `IntegrityError` and `PoolClosedError` inherit that signature. `AuthError` fixes its effective stage to `authenticate`.

Lifecycle, trust, refusal and provider classes instead accept an optional message and choose their own codes/stages. `NameResolutionError(message?, code?)` and `DirectoryAccessError(message?, code?)` accept a second status-code argument. `TlsTrustError` inherits the host-trust constructor. Do not pass a cause as a second argument to those constructors.

The base permits an application-owned cause, but connector wrappers intentionally omit raw transport/provider causes that could contain credentials. A classifier is not a general log sanitizer. `classifyConnectionError(error, stage)` preserves specific shared error instances and maps known connection failures; callers using that helper directly must sanitize transport messages first. Applications should avoid serializing arbitrary error objects or relying on English message matching.

## Publication recovery state

`new PublicationError(message, state)` requires:

| State field | Values |
| --- | --- |
| `destination` | Requested remote destination |
| `temporaryPath` | Optional owned staged file, ending in `/contents` |
| `phase` | prepare, upload, verify, rename, cleanup |
| `outcome` | not-published, published, uncertain |
| `cleanup` | done, retained, failed |

An uncertain rename acknowledgement is not permission to replay a publication. Read the destination and retained state before deciding recovery. A successful rename with failed housekeeping returns a successful `PublicationResult` with `cleanup: 'failed'`; it does not throw a new transfer failure. See [transfer guarantees](/guide/advanced-transfers#publication-and-overwrite-behavior).

## Managed host-store failures

`KnownHostsConflictError` is exported by `@jalsoedesign/dockline-sftp-client` and extends `HostTrustError`. Its zero-argument constructor indicates that the trusted record changed while approval was pending. Inspect and ask for approval against the new state; do not repeat an old approval. Store validation/locking can throw `ConnectorError`, cancellation uses `OperationAbortedError`, and filesystem failures may retain their ordinary Node error identity. See [managed known hosts](/guide/trust#managed-known-hosts-storage).

## Recovery boundaries

Configuration validation can also throw `TypeError` or `RangeError`; do not assume every rejection is a network error. Callers should preserve unknown errors instead of automatically retrying them.

Automatic reconnect is opt-in and `maxTransientRetries` defaults to three extra eligible attempts. Authentication, trust, permission, cancellation and unsupported operations are not transient-retry candidates. A returned read or started mutation cannot be made replay-safe by its error class alone. The operation settings apply globally and per call. `timeoutMs` is a per-attempt deadline; `timeout` remains an alias. External cancellation and queue deadlines do not authorize automatic replay.

## Dependency boundaries

The installed `ssh2-sftp-client` can convert a generic status 4 `lstat` failure into a missing-file result. An existence check can therefore report `false` without confirmed absence. Do not use that result alone to authorize destructive synchronization or recovery. Permission and missing entries remain distinct only where the dependency preserves that distinction. No external source patch is applied.

FTP ambiguous `550` and `553` responses remain errors. A successful parent listing without a matching item can establish absence, but a failed listing cannot.

An optional external Flystorage wrapper can introduce its own error-with-cause boundary. Its default Windows path normalizer also has traversal/separator limitations; do not treat wrapping or a configured root as a security sandbox. Dockline's low-level connectors do not apply that external wrapper automatically. Explicitly validate application paths and choose a verified normalizer if your application adds the wrapper.

These are documented behavior limits, separate from npm advisory counts.

## Catch the ordinary operation

Use a `try/catch` around `connect`, `stat`, `list` or the transfer you already need. A separate diagnostic connection is not required. A successful login does not prove future connectivity or access to each path. Transport wrappers redact configured or resolved passwords and passphrases from ordinary messages and omit raw provider causes; this is not a general sanitizer for arbitrary application objects or logs.
