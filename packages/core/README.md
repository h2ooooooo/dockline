# @dockline/core

The shared Dockline SDK. Install only the protocol clients your application uses. For a source build, follow the [installation guide](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/installation.md#build-from-source).

```sh
npm install @dockline/core @dockline/sftp-client
```

For FTP/FTPS, select `@dockline/ftp-client` instead. Core depends on `@dockline/abstract`; protocol clients are optional peers and are never installed automatically.

```ts
import {Dockline} from '@dockline/core';

await Dockline.withConnection({
    protocol: 'sftp',
    host: process.env.SFTP_HOST!,
    username: process.env.SFTP_USERNAME!,
    password: process.env.SFTP_PASSWORD,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => challenge.fingerprint === process.env.SFTP_SHA256,
    acceptTrustPolicy: () => false,
}, async remote => {
    await remote.uploadFile('./hello.txt', 'hello.txt');
    await remote.downloadFile('hello.txt', './downloaded-hello.txt');
});
```

Supply the host identity, credentials and independently verified server fingerprint before running this example. The local destination's parent directory must exist. Downloads refuse to replace an existing local file by default. Transfers have no default file-size cap; set `maxBytes` to impose one.

`Dockline.create(config)` and `createConnector(config)` synchronously select an installed client without connecting. `Dockline.connect(config)` returns a connected SDK. A missing client throws `MissingClientPackageError` with `protocol`, `packageName` and `installCommand`; a broken installed client's error propagates.

The supported Node versions can load these synchronous ESM client packages with `createRequire`. Core does not statically import either client and its declarations require neither transport library.

See the [repository documentation](https://github.com/h2ooooooo/dockline/tree/main/docs), [SFTP quick start](https://github.com/h2ooooooo/dockline/blob/main/docs/sftp/quick-start.md) and [FTP quick start](https://github.com/h2ooooooo/dockline/blob/main/docs/ftp/quick-start.md).
