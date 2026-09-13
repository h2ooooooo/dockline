# Transfer tools

The low-level `FtpConnector` and `SftpConnector` share progress, bandwidth, checksums, publication, copy and traversal contracts. These are direct connector APIs; an external Flystorage wrapper does not automatically expose the additional methods. Existing `read`, `write` and `moveFile` remain available.

## Progress and bandwidth

```ts
import {BandwidthBudget} from '@jalsoedesign/dockline-abstract';

const bandwidth = new BandwidthBudget({bytesPerSecond: 2_000_000});

await connector.write('archive.zip', openFreshArchive, {
    bandwidth,
    totalBytes: archiveSize,
    progressIntervalMs: 100,
    onProgress(event) {
        updateTransfer(event.bytesTransferred, event.totalBytes, event.stage);
    },
});
```

`totalBytes` is an optional caller-supplied hint; the library does not invent a percentage for an unknown-length stream. Events contain direction, path, one-based attempt, transferred bytes, optional total, elapsed milliseconds and average bytes per second. Stages are `starting`, `transferring`, `completed`, `failed` and `cancelled`. Each retry starts a new byte count. `completed` requires the complete protocol operation; read completion also requires consumption. Counted bytes describe passage through the connector's stream boundary, not durable storage on the server.

Progress defaults to no callback and a 100 ms notification interval when a callback is supplied. Start and final events are always reported. Observer exceptions and rejected observer promises are ignored; they cannot turn a successful write into an automatic replay.

`bandwidth` is either bytes per second for this transfer or a shared `BandwidthBudget`. One shared instance limits the aggregate of all uploads and, separately, all downloads. The scheduler uses FIFO byte quanta. Its default quantum is at most 16 KiB or one tenth of a second's configured rate; `burstBytes` can explicitly select 1–1,048,576 bytes. Rates are averaged over time and incur scheduling overhead. The monitor releases a source chunk after accounting for its bytes, so emitted data can be bursty at the source chunk size; burstBytes is a scheduling quantum, not a strict output-packet cap. Backpressure still applies. Intentional throttling consumes the operation's deadline, so select a suitable `timeoutMs`. There is no background scheduler when bandwidth limiting is unused.

## Checksums

```ts
const result = await connector.checksumDetails('archive.zip', {
    algorithm: 'sha256',
    strategy: 'server-or-stream',
    maxBytes: 500_000_000,
    abortSignal,
});

console.log(result.algorithm, result.strategy, result.digest);
```

The default is SHA-256 and **server-only**: it never downloads a file without explicit permission. `stream` always reads and hashes the file; `server-or-stream` falls back only when server hashing is unsupported. Authentication, permission, timeout or malformed-digest errors do not trigger another strategy. SHA-256 and SHA-512 are supported; other algorithms fail explicitly.

FTP uses advertised HASH support. SFTP currently has no server checksum implementation and requires an explicit stream strategy. A streamed hash checks the byte count against available initial metadata and has no size limit by default. Set `maxBytes` on the connection or call to cap the bytes read; `Infinity` explicitly removes a configured cap. This does not provide a transactional snapshot of a changing file or independent evidence against a malicious server.

`checksum(path, options)` remains the Flystorage-compatible string-returning method. It accepts `algorithm` or `algo`, strategy and limit options; output encoding can be `hex`, `base64` or `base64url`. `checksumDetails` always returns a hexadecimal digest and the actual strategy.

## Publication and overwrite behavior

```ts
const result = await connector.publishFile('release.zip', openFreshRelease, {
    overwrite: 'replace',
    requireAtomicRename: true, // Requires the SFTP POSIX rename extension.
    verify: {algorithm: 'sha256', expectedDigest: independentlyComputedDigest},
    abortSignal,
});
```

Publication creates an exclusively owned temporary directory next to the destination, uploads its `contents` file, optionally verifies it, and finally renames it. Upload and verification size are unlimited by default. A configured `maxBytes` applies to both; an explicit `verify.maxBytes` overrides it for verification, while `undefined` inherits and `Infinity` removes that verification limit. An existing temporary directory never grants ownership. Successful publication returns the destination, whether the actual rename was atomic, whether verification ran, and cleanup status.

The default overwrite policy is `fail`. SFTP uses standard no-replace rename; atomic replacement requires `overwrite: 'replace'` and the server's POSIX rename extension. Atomic no-replace publication is unsupported. FTP cannot guarantee portable no-replace or atomic rename, so callers must explicitly select `overwrite: 'replace'` and cannot require atomic rename. Unsupported policy combinations fail before staging. Plain `write` continues to overwrite directly.

`PublicationError.state` records destination, optional owned temporary path, phase (`prepare`, `upload`, `verify`, `rename`, `cleanup`), outcome and cleanup status. A lost rename acknowledgement is **uncertain**, even if the server actually completed it. The library retains recovery state and never automatically repeats that rename. Inspect the destination and retained temporary state before deciding what to do next.

Cleanup removes only the owned temporary file and then an empty directory. Unexpected additional contents are preserved. Failure cleanup is enabled by default and bounded to cleanup requests; set `cleanupOnFailure: false` to retain the staging area. A successful rename followed by failed cleanup is still returned as published with `cleanup: 'failed'`, so callers do not mistake housekeeping failure for a failed publication.

## Copy strategies

`copyFileWithStrategy(from, to, options)` returns the selected strategy, bytes copied and publication result. `copyFile` returns void for compatibility and can report the result through `onStrategy`.

The documented default `auto` selects `client-streamed`: download through a private local temporary file, then publish using the same connection. This costs local disk space and two transfers, but avoids a second hidden connection and FTP transfer deadlocks. There is no default byte limit. Set `maxBytes` on the connection or call to limit the spool size; per-call `Infinity` removes a configured limit. Cancellation and failures remove the owned local spool. Source and destination must differ.

`server-native` is currently rejected. A transport dependency exposing a copy helper does not establish a server-native copy guarantee. The same overwrite/atomic rules as publication apply; FTP requires explicit replacement. No extra protocol session is created, including when the copy runs inside a connection pool lease.

## Bounded traversal

```ts
const traversal = connector.walk('.', {
    maxDepth: 5,
    maxEntries: 10_000,
    filter: entry => !entry.path.endsWith('/node_modules'),
    abortSignal,
});

for await (const entry of traversal.entries) {
    showEntry(entry);
}

console.log(await traversal.result);
```

Root depth is zero; direct children have depth one. Defaults are depth 32 and 100,000 examined entries. Filtered entries count toward the entry budget and filtered directories are pruned before descent. No reported symbolic link or unsupported special entry is followed. A depth budget of zero performs no listing and reports an incomplete traversal.

The result reports `complete`, `reason` and examined entry count. Reasons distinguish completion, depth or entry exhaustion, cancellation, consumer early exit and failure. Breaking the loop or calling `return()` settles the result and closes the active iterator. Exceptions still propagate through iteration. Cancellation also interrupts waiting for an asynchronous filter; a late filter result cannot resume traversal.

An individual FTP directory listing may be materialized by its dependency before the iterator applies the entry budget. This is not a filesystem-containment or transactional inventory API. Intermediate symlinks and concurrent changes remain application concerns.

## Capability discovery

`await connector.capabilities()` performs no connection. Its versioned report separates `adapter` support from `server` support and uses `supported`, `unsupported` and `unknown`. Use `{negotiate: true}` for explicit read-only feature discovery in the current verified session. SFTP's dependency does not expose a supported extension inventory; unverified server capabilities remain unknown.

An adapter feature and a server advertisement never prove permission at a particular path. Always handle operation errors. Resume, server-native copy, visibility controls and generated public URLs remain unsupported.
