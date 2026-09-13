# @dockline/abstract

Shared contracts and transfer tools for [Dockline](https://github.com/h2ooooooo/dockline). This package contains no FTP or SSH transport implementation and does not require core or either client.

Use it for adapter/configuration types, shared errors, retry and deadline policy, progress, bandwidth budgets, optional byte limits, publication/checksum/copy/walk helpers and connection pools. Core re-exports this generic API for SDK users.

## Installation

For a source build, follow the [compiler guide](https://github.com/h2ooooooo/dockline/blob/main/docs/development/compiler.md#build-from-source).

After publication, the registry command will be:

```sh
npm install @dockline/abstract
```

## Validate configuration without loading a client

```ts
import {validateTransferConfig, type FtpTransferConfig} from '@dockline/abstract';

const configuration: FtpTransferConfig = {
    protocol: 'ftps',
    host: 'ftp.example.com',
    username: 'deploy',
    root: '/uploads',
};
const defaults = validateTransferConfig(configuration);

console.log(defaults.port, defaults.root);
```

This validates common configuration and resolves the default port/root without making a connection. `TransferAdapter` describes the common storage, lifecycle and advanced transfer interface for client implementations. Abstract does not discover or construct protocol clients.

```ts
import {BandwidthBudget, ConnectorError, type TransferAdapter} from '@dockline/abstract';

const bandwidth = new BandwidthBudget({bytesPerSecond: 2_000_000});
```

Transfer size is unlimited unless a connection or call explicitly supplies `maxBytes`. Shared errors retain one runtime identity when clients resolve the same abstract installation. Pooling and transfer helpers operate on a caller-supplied adapter; unsupported guarantees remain explicit.

See [packages](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/packages.md), [API](https://github.com/h2ooooooo/dockline/blob/main/docs/reference/api.md), [advanced transfers](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/advanced-transfers.md) and [connection pools](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/pools.md).
