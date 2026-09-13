# Transfers and session ownership

The convenience API is designed for local files and a single explicit session. Use the same methods for FTP, FTPS and SFTP, and inspect capabilities before relying on optional server behavior.

## Uploads

`uploadFile(localPath, remotePath, options?)` requires a regular local file. It follows the explicit local path, including a local symlink to a file. The remote parent must already exist. Default `overwrite: 'replace'` writes directly and can leave partial remote content if interrupted. A fresh local read stream is opened for each permitted retry; changing the source during a retry is your application's responsibility.

`overwrite: 'fail'` uses the adapter's staged publication and refuses unsupported no-replace semantics before reading the local file. This is currently supported through SFTP's standard rename behavior; FTP cannot promise it. For verification or atomic-replace requirements, use `publishFile` with explicit [publication options](/guide/advanced-transfers).

`write(remotePath, contents, options?)` accepts a string, Buffer, readable stream or fresh-stream factory. Strings and Buffers are wrapped in a repeatable factory. A caller-supplied stream cannot be replayed after consumption.

## Downloads

`downloadFile(remotePath, localPath, options?)` defaults to `overwrite: 'fail'` and has no size limit. Set `maxBytes` on the connection or the individual call to limit a download. The local parent directory must exist. It checks remote metadata, streams into an exclusive staging file in a fresh sibling directory, enforces any configured byte limit while reading, checks the advertised length when available, then publishes the completed file.

```ts
await remote.downloadFile('archive.zip', './archive.zip', {
    overwrite: 'replace',
    maxBytes: 512 * 1024 * 1024,
    abortSignal: controller.signal,
});
```

The example opts into a 512 MiB limit. Omitted or `undefined` values inherit a connection limit, if configured; otherwise the download is unlimited. Pass `{maxBytes: Infinity}` to remove a connection limit for this call. A finite limit must be a non-negative safe integer, and zero permits only an empty file. Size limits do not change configured timeouts, cancellation or bandwidth settings. See [configuration](/guide/configuration#file-size-limits) for shared defaults and uploads.

Before publication, a failed, oversized, truncated or cancelled download leaves the existing destination unchanged and cleans its owned staging file. Default no-replace publication uses a hard link; filesystems that cannot provide it fail rather than using a racy existence check. Replacement uses a same-filesystem rename. The source path and local parent must be trusted; this is not protection against other processes changing parent directories or remote symlinks.

Length verification is not a content checksum and cannot detect same-size changes. Use explicit checksum verification when needed. A local filesystem error during final cleanup can be reported after the destination was published; check the destination before deciding to repeat an operation. If transfer and cleanup both fail, an `AggregateError` retains both errors.

Transfer progress describes transport activity; only the resolved `downloadFile` promise confirms local publication and staging cleanup. A deliberately slow filesystem or bandwidth limit is part of the transfer's elapsed time.

## Streams and listing

`read` returns a Node readable; consume it fully or destroy it before disconnecting. `list(path?, {deep?})` is an async iterable and defaults to shallow listing. `walk` provides bounded recursive enumeration plus a result describing whether the inventory is complete. Stop iterators explicitly when abandoning them.

`Dockline.withConnection` awaits the callback and then disconnects, including failure paths. It preserves an operation error together with any cleanup failure in `AggregateError`. It does not retain a session for a stream merely returned by the callback. For resource-aware leasing use `Dockline.createPool(config, options)` and the [pool API](/guide/pools).

## Advanced access

`remote.connector` exposes the selected client through the shared `TransferAdapter` interface from abstract. The underlying object is the selected `FtpConnector` or `SftpConnector`; import a concrete class or client-specific type from its client package when required. Use it for the lower-level storage adapter API, direct `deleteDirectory`, protocol-specific configuration, and methods beyond the small facade. Methods such as recursive directory deletion retain their explicit low-level semantics; review target paths before calling them.

The adapters implement a shared storage interface and can be used with `FileStorage` from `@flystorage/file-storage`. Dockline's own SDK normalizes its remote paths independently of the local operating system. A separately constructed `FileStorage` wrapper can still apply its own path normalization; see [known limitations](/development/dependencies).

Custom backends can share the exported abstract operation types and `ConnectorPool` contract, while your application chooses their configuration and creation. Core's `TransferConfig` union currently contains only the built-in FTP-family and SFTP adapters; there is no pluggable protocol registry in the convenience facade.
