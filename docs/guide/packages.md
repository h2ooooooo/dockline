# Packages and repository layout

Dockline is one [Git repository](https://github.com/h2ooooooo/dockline) containing five independently versioned npm packages. Install the pieces your application uses. The repository root is a private workspace for development and is never the runtime package.

## Pick the right level

| Package | Responsibility | Runtime dependency boundary |
| --- | --- | --- |
| `@jalsoedesign/dockline-core` | `Dockline`, configuration-based client selection, connection scopes and local file helpers | Depends on abstract. FTP and SFTP clients are optional peers. |
| `@jalsoedesign/dockline-abstract` | Shared adapter/configuration contracts, errors, retry policy, streams, limits, progress, publication, checksums, traversal and pools | Has no FTP or SSH transport implementation. |
| `@jalsoedesign/dockline-ftp-client` | `FtpConnector`, common-config factory, FTP/FTPS sessions, TLS and filename handling | Depends on abstract and `basic-ftp`; does not depend on core or SFTP. |
| `@jalsoedesign/dockline-sftp-client` | `SftpConnector`, common-config factory, SSH authentication, trust and `KnownHostsStore` | Depends on abstract and `ssh2-sftp-client`; does not depend on core or FTP. |
| `@jalsoedesign/dockline-cli` | YAML-configured download, upload, list and remove commands; optional embedding API | Uses core and the selected client; does not bundle either transport. |

Use **CLI plus a client** for terminal commands and YAML configuration. Use **core plus a client** for `Dockline.connect()`, `uploadFile()` and `downloadFile()`. Use a **direct client** for its adapter API without the convenience wrapper. Use **abstract** when building your own adapter or working only with shared errors and transfer tools.

```text
your application
  |
  +-- @jalsoedesign/dockline-core
  |     `-- selects the installed client for the configured protocol
  |
  `-- direct client use
        +-- @jalsoedesign/dockline-ftp-client  -> basic-ftp
        `-- @jalsoedesign/dockline-sftp-client -> ssh2-sftp-client

Core and both clients depend on @jalsoedesign/dockline-abstract.
The clients do not depend on core or on each other.
```

Installing `@jalsoedesign/dockline-core` alone does not install FTP, SFTP or their transport libraries. Importing core does not load both clients. Creating a connector resolves only the package required by `protocol`: FTP, FTPS and implicit FTPS select `@jalsoedesign/dockline-ftp-client`; SFTP selects `@jalsoedesign/dockline-sftp-client`.

The optional [CLI](/guide/cli) uses core for transfers and contributes one executable, `dockline`. Installing the SDK or a direct client does not require the CLI. YAML parsing, command flags, terminal output and interactive host approval belong to the CLI package rather than the transfer engine.

## When a client is missing

`new Dockline(config)`, `Dockline.create(config)` and core's `createConnector(config)` remain synchronous. They validate the configuration and load the selected installed client without opening a network connection. If the selected client is absent, they throw `MissingClientPackageError`.

```ts
import {Dockline, MissingClientPackageError} from '@jalsoedesign/dockline-core';

try {
    const remote = Dockline.create({
        protocol: 'ftp',
        host: 'ftp.example.com',
        username: 'deploy',
        password: process.env.FTP_PASSWORD,
    });

    console.log('FTP client is available; no connection has been opened.');
    console.log(remote.toJSON());
} catch (error) {
    if (error instanceof MissingClientPackageError) {
        console.error(error.protocol, error.packageName, error.installCommand);
    } else {
        throw error;
    }
}
```

The error extends `ConnectorError`, has code `DOCKLINE_CLIENT_NOT_INSTALLED`, and provides the requested `protocol`, required `packageName` and suggested `installCommand`. For FTP, the package is `@jalsoedesign/dockline-ftp-client`; for SFTP, it is `@jalsoedesign/dockline-sftp-client`.

The command is guidance for the application's developer. Dockline never runs it, installs a package or changes protocols. See [installation](/guide/installation) for npm commands covering each package combination. A present but broken client, including a missing dependency or an exception while loading, retains its original error instead of being mislabeled as an absent optional client.

`Dockline.connect()` and `Dockline.withConnection()` return promises. A missing client rejects that promise before authentication. Client installation and host authentication are separate: finding a package does not open a connection or approve a host key.

## Shared exports and concrete clients

```ts
import {Dockline, type FtpTransferConfig, ConnectorError} from '@jalsoedesign/dockline-core';
import {ConnectorPool, type TransferAdapter} from '@jalsoedesign/dockline-abstract';
import {FtpConnector} from '@jalsoedesign/dockline-ftp-client';
import {SftpConnector, KnownHostsStore} from '@jalsoedesign/dockline-sftp-client';
```

Core re-exports the generic abstract API and common configuration types. Its `TransferAdapter` is a structural contract, not a union that imports both concrete clients. `remote.connector` implements that contract. Import a concrete class from its own client package when you need protocol-specific members.

Both clients export `createConnector(commonConfig)` in addition to their existing concrete classes and low-level config types. FTP accepts the FTP/FTPS common-config variants; SFTP accepts the SFTP variant. The direct factory maps common names such as `username` and `root` to the adapter's low-level configuration. It returns a lazy adapter; call `connect()` and close it explicitly, or use the adapter's documented lazy operation behavior.

Shared errors originate in abstract. With one resolved abstract installation, core and the client re-exports use the same constructors. Multiple separately installed copies can have ordinary JavaScript class-identity differences; keep compatible versions aligned.

## Repository layout

```text
Dockline/
  package.json             private npm workspace and shared commands
  package-lock.json        lockfile for all workspaces and development tools
  packages/
    abstract/
      src/
      tests/
      package.json
    core/
      src/
      tests/
      package.json
    ftp-client/
      src/
      tests/
      package.json
    sftp-client/
      src/
      tests/
      package.json
    cli/
      src/
      tests/
      examples/
      package.json
  scripts/                 shared build and distribution checks
  docs/                    separately installed VitePress site
```

Each package has its own manifest, version, public entry point, source and generated `dist/` directory. Published dependency ranges describe npm packages rather than sibling filesystem paths. Local workspaces satisfy those ranges during development; packed-consumer checks install actual tarballs outside the checkout.

The five packages currently have version `1.0.0`. They can be versioned independently, but a shared-contract change must keep dependent ranges and optional peer compatibility accurate. Nothing in this layout publishes a release automatically. See [compiler and package build](/development/compiler).

## Package links

All packages belong to the [Dockline repository](https://github.com/h2ooooooo/dockline); the CLI source is in [packages/cli](https://github.com/h2ooooooo/dockline/tree/main/packages/cli). Each npm package has its own page.

| Package | npm | GitHub source |
| --- | --- | --- |
| `@jalsoedesign/dockline-abstract` | [npm](https://www.npmjs.com/package/@jalsoedesign/dockline-abstract) | [packages/abstract](https://github.com/h2ooooooo/dockline/tree/main/packages/abstract) |
| `@jalsoedesign/dockline-ftp-client` | [npm](https://www.npmjs.com/package/@jalsoedesign/dockline-ftp-client) | [packages/ftp-client](https://github.com/h2ooooooo/dockline/tree/main/packages/ftp-client) |
| `@jalsoedesign/dockline-sftp-client` | [npm](https://www.npmjs.com/package/@jalsoedesign/dockline-sftp-client) | [packages/sftp-client](https://github.com/h2ooooooo/dockline/tree/main/packages/sftp-client) |
| `@jalsoedesign/dockline-core` | [npm](https://www.npmjs.com/package/@jalsoedesign/dockline-core) | [packages/core](https://github.com/h2ooooooo/dockline/tree/main/packages/core) |
| `@jalsoedesign/dockline-cli` | [npm](https://www.npmjs.com/package/@jalsoedesign/dockline-cli) | [packages/cli](https://github.com/h2ooooooo/dockline/tree/main/packages/cli) |

See [updates and releases](/development/releasing) for workspace versioning, publishing and documentation deployment.
