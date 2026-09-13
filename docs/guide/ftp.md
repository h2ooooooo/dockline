# FTP connection and transfer options

FTP, explicit FTPS and implicit FTPS use `FtpConnector` from `@dockline/ftp-client`, backed by `basic-ftp`. This package is usable directly without core or the SFTP client. Its `createConnector(FtpTransferConfig)` factory also accepts the common configuration names. It accepts an ordinary configuration object and does not load configuration from another application. See the [Quick start FTP](/ftp/quick-start) for the convenience API.

```ts
import {FtpConnector, type FtpConnectorConfig} from '@dockline/ftp-client';

const connection: FtpConnectorConfig = {
    host: 'ftp.example.com',
    port: 21,
    user: 'deploy',
    password: suppliedPassword,
    secure: true,
    passive: true,
    initialPath: '/releases',
};
const connector = new FtpConnector({
    ...connection,
    autoReconnect: true,
    maxTransientRetries: 3,
    timeoutMs: 30000,
    keepalive: {intervalMs: 30000, maxMissed: 2},
    onConnectionState(event) {
        updateConnectionStatus(event.state);
    },
});
```

## Protocol and transport settings

`secure: false` selects plain FTP, `secure: true` selects explicit TLS, and `secure: 'implicit'` selects implicit TLS. Supply the server's port explicitly: commonly 21 for FTP/explicit TLS and 990 for implicit TLS. `secureOptions` accepts Node TLS options such as a trusted private CA or `servername`; certificate validation remains enabled unless your application changes it.

The low-level config uses `user`, `password`, `host`, `port`, `secure`, `passive` and `initialPath`. The convenience API normalizes common connection names; see [configuration](/guide/configuration). `initialPath` changes the working directory after authentication. It is a starting directory, not a path-containment guarantee.

Passive transfers are supported. `passive: null` or `true` uses the dependency's passive transport; explicit active mode (`false`) is rejected. `connect()` is optional before an operation because the first operation connects lazily. Always `await connector.disconnect()` in a `finally` block when you own the connector, and fully consume returned streams before releasing a session.

Transfers have no size limit by default. Set `maxBytes` on the connector or an individual call to impose one. An omitted or `undefined` call value inherits the connector limit; `Infinity` explicitly removes it for that call. This applies to reads, writes, streamed checksums and client-streamed copies. See [file size limits](/guide/configuration#file-size-limits) for validation and verification options.

## Catch connection failures in the normal flow

Call `connect()` or any ordinary connector operation and catch a specific exception. No separate diagnostic connection or probing mode is required.

```ts
import {
    AuthError,
    CredentialProviderError,
    DirectoryAccessError,
    NameResolutionError,
    ConnectionRefusedError,
    TlsTrustError,
} from '@dockline/ftp-client';

try {
    await connector.connect();
} catch (error) {
    if (error instanceof CredentialProviderError) {
        showCredentialProviderFailure();
    } else if (error instanceof AuthError) {
        showRejectedCredentials();
    } else if (error instanceof TlsTrustError) {
        showCertificateFailure();
    } else if (error instanceof NameResolutionError) {
        showUnknownHost();
    } else if (error instanceof ConnectionRefusedError) {
        showConnectionRefused();
    } else if (error instanceof DirectoryAccessError) {
        showInitialDirectoryFailure();
    } else {
        throw error;
    }
}
```

`CredentialProviderError` extends `AuthError`, so catch it first when the distinction matters. Errors expose a `stage` where available: `resolve`, `connect`, `trust`, `credentials`, `authenticate`, `directory`, or `ready`. The FTP handshake uses the dependency's public connection, TLS, login and setup methods so failures retain their stage. Implicit FTPS combines TCP and TLS negotiation; certificate error codes identify trust failures within that combined step. Other transport failures remain `ConnectorError` with their available code and stage.

`OperationAbortedError`, `OperationTimeoutError`, `ConnectionClosedError` and unsupported-option errors retain their original classes. An inaccessible initial directory does not prove that the credentials or TLS handshake failed. A successful connection does not prove permission to change every remote path. Ambiguous FTP `550` responses are not converted into “file missing.”

Returned provider passwords are redacted from transport messages. Provider failures have a fixed public message and omit the original provider exception. Raw transport causes and handshake material are not attached to the mapped exception.

## Resolve credentials in your own CLI, UI or vault

```ts
const connector = new FtpConnector({
    ...connection,
    credentialProvider: async context => {
        const password = await askForPassword(context.siteId, {
            abortSignal: context.abortSignal,
        });

        return {type: 'password', password};
    },
});
```

The callback receives your optional `siteId`, host, port, `protocol: 'ftp'`, `purpose: 'connect' | 'reconnect'`, a one-based attempt number and an `AbortSignal`. Return `{type: 'password', password, username?}`. An omitted username keeps the configured username. Private-key and SSH-agent credential results are rejected for FTP.

The provider runs for each new connection attempt, including a permitted reconnect. It does not run again for ordinary operations on an authenticated connection. Network retries may therefore call it again; cache or reuse a prompt result in the application if desired. A rejected provider result, unsupported credential material, or a deadline while waiting for the provider is not retried. A timeout, external cancellation or `disconnect()` aborts the supplied signal. A provider that ignores cancellation cannot cause late authentication after the connector has abandoned that attempt.

The provider owns its CLI, UI or vault interaction. This does not implement FTP account login, arbitrary challenge-response authentication or SSH interactive authentication.

Returned credentials are not copied into the connector's configuration. The active password is retained privately for session error redaction and released on explicit disconnect or the next credential request. JavaScript strings cannot be securely erased; applications own any caching and secure storage decisions.

## Retry and keepalive policy

| Option | Default | Meaning |
| --- | --- | --- |
| `autoReconnect` | `false` | Permit reconnecting a lost established session for eligible operations. |
| `maxTransientRetries` | `3` | Additional safe transient attempts after the first attempt. |
| `timeoutMs` | `30000` | Per-attempt deadline, including provider, handshake and operation; `0` disables it. |
| `abortSignal` | unset | Cancel queue waiting, connection work or an active operation. |
| `keepalive` | disabled | Opt-in idle FTP `NOOP` probes. |
| `keepalive.intervalMs` | required | Positive integer milliseconds between idle probes. |
| `keepalive.maxMissed` | `2` | Stop an otherwise open session after this many rejected probes. |

The same operation settings can be supplied globally or per call. A per-call value takes precedence. `timeout` remains an alias for `timeoutMs`.

One physical FTP connection serializes all operations, including listings and keepalives. An active transfer or queued foreground operation prevents idle probes. Keepalives never insert a command into a running FTP transfer. Failed probes do not start a background reconnect or repeatedly prompt for credentials. At the missed-probe threshold the connection is invalidated; the next foreground operation follows `autoReconnect`. A socket failure or deadline can invalidate the session earlier. Disconnect clears its timer. Timers do not keep the Node.js process alive.

`onConnectionState` observes `connecting`, `ready`, `disconnected`, `reconnecting` and `failed` events. `connectionState` exposes the latest observed state. Event callbacks cannot change the operation's successful result by throwing. A ready event reports authenticated setup completion, not future network availability.

Permission, authentication and trust failures are not retried. A started one-shot upload, partially consumed read or uncertain mutation is not replayed. Use a source factory for an upload you deliberately permit to restart from the beginning:

```ts
await connector.write('release.zip', () => createReadStream(localPath), {
    autoReconnect: true,
    maxTransientRetries: 2,
});
```

## Transfer progress and bandwidth

```ts
import {BandwidthBudget} from '@dockline/abstract';

const bandwidth = new BandwidthBudget({bytesPerSecond: 2_000_000});

await connector.write('release.zip', () => createReadStream(localPath), {
    bandwidth,
    totalBytes: localFileSize,
    progressIntervalMs: 100,
    onProgress(event) {
        renderTransfer(event);
    },
});
```

`bandwidth` accepts a bytes-per-second number or a shared `BandwidthBudget`. One shared instance enforces an aggregate budget separately for uploads and downloads. Stream backpressure is preserved; file contents are not buffered into one complete file for progress or throttling. Deliberate throttling still counts against `timeoutMs`, so increase the operation deadline for slow transfers.

Progress events contain `direction`, optional `path`, one-based `attempt`, `stage`, `bytesTransferred`, optional `totalBytes`, `elapsedMs` and average `bytesPerSecond`. Stages are `starting`, `transferring`, `completed`, `failed` and `cancelled`. Byte counts start again for each attempt and increase within that attempt. Unknown totals remain absent; the connector does not invent percentages or make a metadata request solely to report progress. Callback delivery defaults to a 100 ms interval; `0` reports every counted chunk. Terminal events bypass that interval.

For a download, consume the returned stream fully. `completed` is emitted only after the data has drained and the FTP server has confirmed the final control response. Receiving all apparent body bytes is insufficient if the final FTP response rejects the transfer. Abandoning a read destroys its transfer and invalidates the connection. Progress callback failures do not trigger transfer retries.

## Filename encoding

```ts
const connector = new FtpConnector({
    ...connection,
    filenameEncoding: {charset: 'latin1', onUnrepresentable: 'reject'},
});
```

Supported values are UTF-8 (`utf8` or `utf-8`), ASCII (`ascii`) and ISO-8859-1 (`latin1` or `iso-8859-1`). Matching is case-insensitive. UTF-8 is the default. Legacy encodings must be selected explicitly; the connector does not guess an encoding.

The connector configures the dependency's control/listing encoding and validates path arguments, returned directory names and restored working directories. File content bytes are unchanged. ASCII mode uses latin1 decoding internally and then validates ASCII, which prevents Node's ASCII decoder from silently stripping a high bit and selecting a different filename. Unrepresentable names, unpaired UTF-16 surrogates and command delimiters are rejected before the affected operation. UTF-8 names containing the replacement character U+FFFD are rejected because the dependency has already decoded incoming bytes and cannot distinguish an actual replacement character from a decoding failure.

Explicit legacy mode requires the server to accept `OPTS UTF8 OFF` after login and default setup. A server that refuses this command is rejected even if a different client might be able to infer its legacy behavior. This conservative policy avoids operating on the wrong filename. Unsupported encodings such as Windows-1252 are rejected: Windows-1252 and ISO-8859-1 are not interchangeable. Real loopback fixtures cover UTF-8 and latin1 names through write, listing, read, rename and delete, with exact binary payload preservation.

These choices use [basic-ftp's documented encoding control](https://github.com/patrickjuchli/basic-ftp) and the supported [Node.js character encodings](https://nodejs.org/api/buffer.html#buffers-and-character-encodings). They do not add transcoding support that the transport cannot provide.

## Capabilities, publication, copy and checksums

`await connector.capabilities()` reports adapter support without connecting. Use `{negotiate: true}` to authenticate and query FTP `FEAT`. Server advertisements are distinct from adapter support and from permissions on a particular path. `serverFeatures()` returns a frozen list from the current verified session.

FTP cannot guarantee a portable no-clobber or atomic rename. Consequently `publishFile()` and `copyFileWithStrategy()` require the explicit option `{overwrite: 'replace'}`. Their default no-clobber policy and `requireAtomicRename: true` fail before network mutation. Successful FTP publication reports `atomic: false`; it must not be advertised as an atomic deployment.

Publication uses an exclusively created staging directory, writes its owned content and renames only after upload/optional verification. Cleanup deletes only its owned content followed by non-recursive `RMD`; unrelated files prevent cleanup rather than being recursively deleted. An uncertain rename retains evidence for the caller to reconcile. `createDirectoryExclusive()` uses one `MKD`, while ordinary `createDirectory()` retains its recursive creation behavior.

`copyFileWithStrategy()` uses the shared explicit copy strategy and reports the strategy used. FTP has no native copy implementation. The client-streamed strategy spools through a temporary local file with no default size limit, then publishes using the same physical connection; it does not open a hidden extra connection. `copyFile()` is the compatible void-returning wrapper and accepts the same strategy options. A streaming checksum is likewise opt-in because it reads the full remote file.

```ts
const checksum = await connector.checksumDetails('release.zip', {
    algorithm: 'sha256',
    strategy: 'server-or-stream',
    maxBytes: 512 * 1024 * 1024,
});

console.log(checksum.strategy, checksum.digest);
```

The default checksum strategy is `server-only`. FTP server hashes require `FEAT HASH` to advertise SHA-256 or SHA-512. The connector serializes algorithm selection and `HASH` on the same connection and rejects malformed, mismatched-algorithm and partial-range replies. Only reviewed complete-file reply forms are accepted; arbitrary extensions are not guessed. `server-or-stream` falls back only for unsupported hashing, not for permission failures or malformed results. The compatible `checksum()` wrapper accepts `algo` or `algorithm` and `hex`, `base64` or `base64url` output encoding.

`walk()` returns `{entries, result}` for bounded traversal. Consume `entries` and inspect `result` for completion or truncation instead of treating a page or limit as a complete tree. Keep ordinary `list()` for its existing interface.
