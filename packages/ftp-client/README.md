# @jalsoedesign/dockline-ftp-client

FTP, explicit FTPS and implicit FTPS for [Dockline](https://github.com/h2ooooooo/dockline), backed by `basic-ftp`. Use this client directly or install it alongside `@jalsoedesign/dockline-core` for the common `Dockline` API and local file helpers.

The client depends on `@jalsoedesign/dockline-abstract` and its own FTP transport stack. It does not require core, the SFTP client or the SSH transport libraries.

## Installation

For a source build, follow the [compiler guide](https://github.com/h2ooooooo/dockline/blob/main/docs/development/compiler.md#build-from-source).

Choose the installation matching your API:

```sh
npm install @jalsoedesign/dockline-core @jalsoedesign/dockline-ftp-client
```

For only the direct client:

```sh
npm install @jalsoedesign/dockline-ftp-client
```

## Use the client directly

`createConnector()` accepts the common FTP configuration and returns a concrete `FtpConnector` without connecting:

```ts
import {createConnector} from '@jalsoedesign/dockline-ftp-client';

const connector = createConnector({
    protocol: 'ftps',
    host: 'ftp.example.com',
    username: 'deploy',
    password: process.env.FTP_PASSWORD,
    root: '/uploads',
});

try {
    await connector.connect();

    for await (const entry of connector.list('.', {deep: false})) {
        console.log(entry.path, entry.type);
    }
} finally {
    await connector.disconnect();
}
```

Supply your actual server settings and credentials. `ftps` uses explicit TLS on port 21; `ftps-implicit` uses implicit TLS on port 990; `ftp` is unencrypted FTP on port 21. Set a different `port` when required. FTPS verifies certificates. Passive mode is supported; active mode is rejected.

The established `new FtpConnector(FtpConnectorConfig)` constructor remains available with low-level names such as `user`, `initialPath` and `secure`. Direct adapter paths retain their low-level semantics. Core supplies the relative-path convenience layer and `uploadFile()`/`downloadFile()`.

## Transfers and controls

The adapter provides listing, metadata, streamed reads/writes, directories, deletion, explicit rename/publication policies, progress, bandwidth budgets, timeouts, cancellation, eligible retries and capability reports. Size is unlimited by default; set `maxBytes` explicitly when needed. Consume returned streams before closing the session.

FTP cannot guarantee portable no-replace or atomic rename. Publication and rename require explicit replacement permission where documented. Unsupported guarantees fail instead of being silently weakened.

See [Quick start FTP](https://github.com/h2ooooooo/dockline/blob/main/docs/ftp/quick-start.md) for connecting, local-to-remote uploads, remote-to-local downloads and everyday operations through core. Read [FTP options](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/ftp.md), [API](https://github.com/h2ooooooo/dockline/blob/main/docs/reference/api.md) and [errors](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/errors.md) for direct-client details.
