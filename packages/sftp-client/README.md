# @dockline/sftp-client

SFTP, SSH authentication and explicit host trust for [Dockline](https://github.com/h2ooooooo/dockline), backed by `ssh2-sftp-client`. Use this client directly or alongside `@dockline/core` for the common `Dockline` API and local file helpers.

The client depends on `@dockline/abstract` and its own SSH/SFTP transport stack. It does not require core, the FTP client or `basic-ftp`.

## Installation

For a source build, follow the [compiler guide](https://github.com/h2ooooooo/dockline/blob/main/docs/development/compiler.md#build-from-source).

Choose the installation matching your API:

```sh
npm install @dockline/core @dockline/sftp-client
```

For only the direct client:

```sh
npm install @dockline/sftp-client
```

## Use the client directly

Obtain the server's OpenSSH `SHA256:…` fingerprint from your administrator or another trusted source, then supply it through `SFTP_SHA256`:

```ts
import {createConnector} from '@dockline/sftp-client';

const fingerprint = process.env.SFTP_SHA256;

if (!fingerprint) {
    throw new Error('Supply the independently verified SFTP_SHA256 fingerprint');
}

const connector = createConnector({
    protocol: 'sftp',
    host: 'sftp.example.com',
    username: 'deploy',
    password: process.env.SFTP_PASSWORD,
    root: '/uploads',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => challenge.fingerprint === fingerprint,
    acceptTrustPolicy: () => false,
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

Supply your actual server settings and credentials. Port 22 is the default. This fixed-host example rejects unfamiliar or changed keys. When `requireTrustPolicy` is true, both hooks are required. Shared lookups for multiple destinations should compare host and port as well as the key.

The established `new SftpConnector(SftpConnectorConfig)` constructor remains available with low-level `port` and `initialPath` fields. Direct paths retain their low-level semantics. Core supplies the relative-path convenience layer and `uploadFile()`/`downloadFile()`.

## Authentication and remembered trust

The client supports passwords, private keys, selected SSH agents, application credential providers and keyboard-interactive responses. It does not choose a CLI, UI or vault. Host policy callbacks decide whether to accept an identity; `KnownHostsStore` can remember only explicitly approved decisions.

```ts
import {KnownHostsStore} from '@dockline/sftp-client';
```

`KnownHostsStore` is owned by this client and is not re-exported from core. See [host trust](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/trust.md) for persisted approval and changed-key handling.

Size is unlimited by default; configure `maxBytes` when a transfer needs a cap. Timeouts, cancellation, streams, progress, retry controls and explicit publication guarantees share the abstract contracts. Consume returned streams before closing the session.

See [Quick start SFTP](https://github.com/h2ooooooo/dockline/blob/main/docs/sftp/quick-start.md) for connection, downloads, uploads and everyday operations through core. Read [SSH options](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/sftp.md), [API](https://github.com/h2ooooooo/dockline/blob/main/docs/reference/api.md) and [errors](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/errors.md) for direct-client details.
