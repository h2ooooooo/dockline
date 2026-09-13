# Configuration

`TransferConfig` is the union of `FtpTransferConfig` and `SftpTransferConfig`, defined in `@dockline/abstract` and re-exported by `@dockline/core`. Choose the protocol explicitly and install its [matching client](/guide/packages); all connection values come from your application. The concrete client factories accept these common configuration types too.

| Field | Behavior |
| --- | --- |
| `protocol` | `ftp`, `ftps`, `ftps-implicit` or `sftp` |
| `host`, `username` | Required connection identity |
| `port` | Defaults to 21, 990 for implicit FTPS, or 22 for SFTP |
| `root` | Starting remote directory, default empty; SDK operation paths are relative to it |
| `password` | Optional static password; an explicit credential provider can replace it |
| `autoReconnect` | Default false; enable permitted reconnects after connection loss |
| `maxTransientRetries` | Default 3 additional safe transient attempts after the first |
| `timeoutMs` | Default 30000 ms per operation attempt; zero disables the deadline |
| `abortSignal` | Optional default signal; a call can supply its own |
| `maxBytes` | Unlimited by default; optional per-transfer byte limit, overridable per call |
| `onProgress`, `totalBytes`, `progressIntervalMs`, `bandwidth` | Transfer observation and limits |
| `credentialProvider` | Application callback for each connection attempt |
| `keepalive`, `onConnectionState` | Protocol keepalives and lifecycle observation |

Global operation options are supplied with the connection. Per-call values override them without changing the saved defaults:

```ts
const remote = Dockline.create({
    ...connection,
    autoReconnect: true,
    maxTransientRetries: 3,
    timeoutMs: 30000,
});

await remote.uploadFile('./large.zip', 'large.zip', {
    timeoutMs: 120000,
    maxTransientRetries: 1,
    abortSignal: controller.signal,
});
```

These are bounded retries of eligible operations, not a guarantee of eventual delivery. Authentication, permissions, host trust, missing files and cancellation are not retried. Consumed reads and uncertain mutations are not blindly replayed. Upload retry needs a fresh source factory; `uploadFile` creates one from the local file. Keep that file unchanged until the call finishes.

## File size limits

File size is unlimited by default for both protocols. An optional `maxBytes` on a Dockline configuration or direct connector configuration becomes the default for each transfer. The same option on a call overrides it. It applies to raw reads/writes, local uploads/downloads, streamed checksums and client-streamed copies.

```ts
const limitedRemote = Dockline.create({
    ...connection,
    maxBytes: 512 * 1024 * 1024,
});

await limitedRemote.downloadFile('report.pdf', './report.pdf');
await limitedRemote.downloadFile('archive.zip', './archive.zip', {maxBytes: Infinity});
await limitedRemote.uploadFile('./small.txt', 'small.txt', {maxBytes: 1024 * 1024});
```

The first call inherits the 512 MiB limit. The second explicitly removes it, and the third selects a 1 MiB limit for that upload. Omitting `maxBytes` or passing `undefined` inherits the connection value; it does not remove a configured limit.

Finite limits must be non-negative safe integers. Zero allows only empty content, and `Infinity` explicitly selects unlimited size. Negative, fractional, unsafe, `NaN` and other invalid values reject before transfer I/O. Limits apply to each transfer, not the aggregate of transfers on a connection. `totalBytes` remains a progress hint and does not restrict file size. Timeouts, cancellation and bandwidth settings are independent.

Publication verification inherits the publication's limit. Supply `verify.maxBytes` to override it for verification only; `undefined` inherits and `Infinity` makes that verification read unlimited. See [transfer tools](/guide/advanced-transfers) for publication and copy behavior.

## Protocol-specific settings

FTP config includes `secureOptions`, `passive` and filename encoding. Omitted `passive` defaults to true; null also selects the supported passive transport. Active mode is rejected. The common SDK maps `username` to the low-level adapter's `user`, `root` to `initialPath`, and the protocol to the TLS mode.

SFTP config includes passwords/private keys, `privateKeyPath`, `passphrase`, `agent`, keyboard-interactive callbacks, host verification, trust policy hooks and SSH handshake options. See [SFTP](/guide/sftp) for exact authentication and agent behavior.

`requireTrustPolicy` stays opt-in in both APIs. When true, both `hasTrustPolicy` and `acceptTrustPolicy` must be functions. **Configure a policy or `hostVerifier` whenever SSH host verification is required.** Without either, the underlying permissive behavior is preserved. The library does not open a prompt or silently create a trust database. [Trust](/guide/trust) covers fixed pins and persisted decisions.

## Paths and configuration ownership

SDK operation paths use forward slashes and reject absolute paths, backslashes, drive prefixes, control characters, invalid Unicode and `..` segments. `.` selects the root for listing, walking or stat. Empty file names are rejected. `root` accepts an absolute or relative remote starting directory; it rejects backslashes, controls and parent traversal.

This is lexical validation, not a server-side sandbox. Remote symlinks or concurrent server changes can escape a directory boundary. Lower-level adapter methods remain available with their original path semantics; keep paths relative when using the SDK contract.

`JSON.stringify(remote)` returns only protocol, host, port and root. Do not serialize or log the underlying connector, arbitrary config objects or your provider's credentials. Identity metadata can itself be sensitive. Dockline does not own configuration file persistence or credential encryption.
