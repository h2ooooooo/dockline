**[Read the documentation](https://h2ooooooo.github.io/dockline/)**

# Dockline

One TypeScript API for FTP, explicit/implicit FTPS and SFTP, with an optional YAML-configured CLI. Install the protocol clients your application uses, with direct access to their adapters when you need more control.

Source: [h2ooooooo/dockline](https://github.com/h2ooooooo/dockline). Node `^22.22.2 || ^24.15.0 || >=26.0.0`, npm `>=12.0.2`. The packages are ESM with generated TypeScript declarations.

## Packages

| Package | What it provides |
| --- | --- |
| `@jalsoedesign/dockline-core` | The `Dockline` API, connection scopes, local file helpers and shared exports. Install a matching client to connect. |
| `@jalsoedesign/dockline-abstract` | Shared contracts, configuration types, errors, retries, streams, transfer helpers and pools; no FTP or SSH transport implementation. |
| `@jalsoedesign/dockline-ftp-client` | FTP, explicit FTPS and implicit FTPS using `basic-ftp`. Usable directly without core. |
| `@jalsoedesign/dockline-sftp-client` | SFTP, SSH authentication, host trust and managed known hosts. Usable directly without core. |
| `@jalsoedesign/dockline-cli` | The `dockline` command: download, upload, list and remove using YAML settings. |

The repository is an npm workspace. Install the individual packages for applications or the CLI for terminal use.

## Install

To contribute to Dockline, follow [build from source](docs/development/compiler.md#build-from-source).

### Global CLI

```sh
npm i -g @jalsoedesign/dockline-cli @jalsoedesign/dockline-ftp-client @jalsoedesign/dockline-sftp-client
dockline --help
```

Install only the client packages needed for the protocols you use. FTP and both FTPS variants use the FTP client.

### Local CLI

```sh
npm i @jalsoedesign/dockline-cli @jalsoedesign/dockline-sftp-client
npm exec -- dockline --help
```

### TypeScript or JavaScript SDK

```sh
npm i @jalsoedesign/dockline-core @jalsoedesign/dockline-sftp-client
```

Use `@jalsoedesign/dockline-ftp-client` for FTP/FTPS, or install both clients. See [installation](docs/guide/installation.md) for direct adapters, shared tools and source builds.

## Terminal commands

Create `dockline.server.yml` with your connection settings:

```sh
dockline download --source-file "/home/ftp/blabla.txt" --destination-file "blabla.txt" --config dockline.server.yml
dockline upload -s "./hello.txt" -d "/home/ftp/hello.txt"
dockline list -p "/home/ftp"
```

For a local npm installation, run these through `npm exec -- dockline` or an npm script. [CLI quick start](docs/guide/cli.md), [commands](docs/cli/commands.md) and [YAML configuration](docs/cli/configuration.md) cover installation, trust, path resolution, JSON and advanced settings. Protocol clients stay optional.

## Quick starts

Choose [Quick start FTP](docs/ftp/quick-start.md) or [Quick start SFTP](docs/sftp/quick-start.md). Each covers connecting, downloading remote files, uploading local files and everyday file operations. The documentation has a dedicated section for each protocol.

The short SFTP example below uses core plus the SFTP client:

```ts
import {Dockline, type SftpTransferConfig} from '@jalsoedesign/dockline-core';

const fingerprint = process.env.SFTP_SHA256;

if (!fingerprint) {
    throw new Error('Set SFTP_SHA256 to the host fingerprint verified with your administrator');
}

const connection: SftpTransferConfig = {
    protocol: 'sftp',
    host: 'sftp.example.com',
    username: 'deploy',
    password: process.env.SFTP_PASSWORD,
    root: '/uploads',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => challenge.fingerprint === fingerprint,
    acceptTrustPolicy: () => false,
};

await Dockline.withConnection(connection, async remote => {
    await remote.uploadFile('./hello.txt', 'hello.txt');
    await remote.downloadFile('hello.txt', './hello-downloaded.txt');
});
```

The local source and remote root must exist. Uploads replace by default. Downloads refuse to overwrite an existing local file by default and stage the download before publishing it. File size is unlimited unless `maxBytes` is configured. The callback completes before the connection closes. Host trust, credentials and prompts belong to your application.

Core loads only the installed client for the selected protocol when a connector is created. If that client is absent, it throws `MissingClientPackageError` with the protocol, package name and installation command. It does not install packages or fall back to another protocol. See [package loading](docs/guide/packages.md#when-a-client-is-missing).

## More control

- Common `protocol`, `host`, `username`, `port` and `root` fields.
- Global and per-call timeouts, cancellation, optional byte limits and bounded transient retries.
- Streams, progress, bandwidth budgets, pools and keepalives.
- Staged publication, explicit rename policies, checksums, copy strategies and inventory walking.
- SSH agents, interactive callbacks, credential providers and an optional managed known-hosts store in the SFTP client.
- `remote.connector` for the shared adapter contract, or direct imports from the selected client package for its concrete API.

Adapters expose capability reports. Unsupported protocol semantics fail explicitly. Automatic reconnect is off by default. The default retry budget is three additional safe transient attempts, never a blanket replay of uncertain writes or partially consumed streams.

## Documentation and development

The complete VitePress source is in [`docs`](docs/index.md). Start with [packages](docs/guide/packages.md), [installation](docs/guide/installation.md), [configuration](docs/guide/configuration.md), [API](docs/reference/api.md), [specification](docs/spec/architecture.md) and [testing](docs/development/testing.md).

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run check:packages
npm run check:consumer
npm run docs:install
npm run docs:build
npm run docs:dev
```

See [dependencies](docs/development/dependencies.md) for the remaining development-only FTP test-server advisory and live audit commands. See [CLI integration](docs/guide/cli-integration.md) to use the SDK or packaged commands in your own tool.

See [updates and releases](https://h2ooooooo.github.io/dockline/development/releasing.html) for updating all packages, publishing to npm and deploying documentation.

## SSH command execution

The optional [`@jalsoedesign/dockline-ssh-client`](https://github.com/h2ooooooo/dockline/tree/main/packages/ssh-client) workspace provides SSH commands, sudo scopes and SFTP helpers. See the [SSH guide](https://h2ooooooo.github.io/dockline/ssh/quick-start).
