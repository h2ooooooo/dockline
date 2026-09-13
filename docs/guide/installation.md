# Installation

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and npm `>=12.0.2`. Dockline's packages are ESM and include declarations. There is no separate CommonJS build or browser transport.

Install `@dockline/core` plus the client for the protocols your application uses. Core alone installs shared infrastructure through `@dockline/abstract`, but neither transport client. The [package guide](/guide/packages) explains the boundaries.

## Install from npm

Choose the packages needed by your application. These commands require a published release; use [build from source](#build-from-source) for an unpublished checkout.

| Application | Command |
| --- | --- |
| Core only | `npm install @dockline/core` |
| FTP/FTPS | `npm install @dockline/core @dockline/ftp-client` |
| SFTP | `npm install @dockline/core @dockline/sftp-client` |
| Both | `npm install @dockline/core @dockline/ftp-client @dockline/sftp-client` |
| Direct FTP | `npm install @dockline/ftp-client` |
| Direct SFTP | `npm install @dockline/sftp-client` |
| Shared tools only | `npm install @dockline/abstract` |
| CLI for FTP/FTPS | `npm install @dockline/cli @dockline/ftp-client` |
| CLI for SFTP | `npm install @dockline/cli @dockline/sftp-client` |

`@dockline/abstract` is an ordinary dependency of core and both clients. Core lists the protocol clients as optional peers, so npm does not install either merely because core is installed. There is no Dockline auto-installer.

### Global CLI

```sh
npm i -g @dockline/cli @dockline/ftp-client @dockline/sftp-client
dockline --help
```

Omit an unused client. For a local project dependency, use `npm i @dockline/cli` with the selected client and run `npm exec -- dockline`. Install clients globally alongside a global CLI, or locally alongside a local CLI.

## Build from source

The source repository is [h2ooooooo/dockline](https://github.com/h2ooooooo/dockline). Build and pack each workspace from a source checkout.

```sh
git clone https://github.com/h2ooooooo/dockline.git
cd dockline
npm ci
npm run build
npm pack --workspaces
```

The root is a private workspace. Pack its packages with `--workspaces`; do not install or pack the repository root as if it were the SDK. The command produces:

```text
dockline-abstract-1.0.0.tgz
dockline-core-1.0.0.tgz
dockline-ftp-client-1.0.0.tgz
dockline-sftp-client-1.0.0.tgz
dockline-cli-1.0.0.tgz
```

## Install built tarballs

Run one of these commands in your application's directory, replacing `/path/to/Dockline` with the location of the tarballs. Include the abstract tarball in the same install so local packages can satisfy their shared dependency without a registry release.

### CLI with a protocol client

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz /path/to/Dockline/dockline-cli-1.0.0.tgz /path/to/Dockline/dockline-ftp-client-1.0.0.tgz
```

This provides the `dockline` command with FTP/FTPS. For SFTP, replace the FTP client tarball with the SFTP client tarball. Install both clients when needed. From a local npm installation run `npm exec -- dockline --help`; see the [CLI quick start](/guide/cli) for a YAML connection and real file commands. The CLI does not install a missing client automatically.

### Global CLI from tarballs

Install all selected tarballs together into the global prefix:

```sh
npm i -g /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz /path/to/Dockline/dockline-cli-1.0.0.tgz /path/to/Dockline/dockline-ftp-client-1.0.0.tgz /path/to/Dockline/dockline-sftp-client-1.0.0.tgz
dockline --help
```

Omit an unused protocol client. The explicit tarballs satisfy internal dependencies without a registry release.

### Core only

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz
```

This gives you the SDK, shared types, errors and tools. Creating a connection for an absent protocol client throws `MissingClientPackageError`; core does not download a transport automatically.

### FTP and FTPS

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz /path/to/Dockline/dockline-ftp-client-1.0.0.tgz
```

Continue with [Quick start FTP](/ftp/quick-start). This combination does not install the SFTP client or SSH transport stack.

### SFTP

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz /path/to/Dockline/dockline-sftp-client-1.0.0.tgz
```

Continue with [Quick start SFTP](/sftp/quick-start). This combination does not install the FTP client or `basic-ftp`.

### Both protocol clients

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-core-1.0.0.tgz /path/to/Dockline/dockline-ftp-client-1.0.0.tgz /path/to/Dockline/dockline-sftp-client-1.0.0.tgz
```

The same `Dockline` API now supports FTP, FTPS and SFTP. Core selects the installed client from the configuration's `protocol`.

### A direct client without core

```sh
npm install /path/to/Dockline/dockline-abstract-1.0.0.tgz /path/to/Dockline/dockline-ftp-client-1.0.0.tgz
```

The client's `createConnector()` accepts common configuration while returning its concrete adapter:

```ts
import {createConnector} from '@dockline/ftp-client';

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

Use the SFTP client tarball and import from `@dockline/sftp-client` for the equivalent SSH adapter; configure [host trust](/guide/trust) explicitly. Direct clients expose `FtpConnector` or `SftpConnector` as well as their factory. They do not include core's local `uploadFile()`/`downloadFile()` convenience wrapper. See [FTP](/guide/ftp) and [SFTP](/guide/sftp) for low-level configuration and methods.

## Linked development

Running `npm ci` in the Dockline root links its five local workspaces. Build after source changes; package entry points load each workspace's `dist/` output.

For another application's linked setup, point its dependencies at the individual package folders, for example `../Dockline/packages/core` and `../Dockline/packages/sftp-client`, plus `../Dockline/packages/abstract`. Install the selected packages together and rebuild Dockline after changes. The existing checkout must remain available. Tarball installs are independent of that checkout and are the stronger distribution check. The private root directory is not a consumer dependency.

## TypeScript and JavaScript

```ts
import {Dockline, type TransferConfig} from '@dockline/core';
import {ConnectorPool} from '@dockline/abstract';
import {FtpConnector} from '@dockline/ftp-client';
import {SftpConnector, KnownHostsStore} from '@dockline/sftp-client';
```

Only import concrete clients your application installs. Core re-exports generic shared types and helpers, so an SDK user can also import `ConnectorPool` from `@dockline/core`. It does not re-export concrete adapters or `KnownHostsStore`.

Use `module` and `moduleResolution` set to `NodeNext` in a Node TypeScript application, and `"type": "module"` in its package manifest. CommonJS callers can use dynamic `import()`. The packed-consumer check uses strict declaration checking with `skipLibCheck: false`.

## Documentation toolchain

Documentation has its own manifest and lockfile so VitePress is not a runtime dependency:

```sh
npm run docs:install
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Development and preview listen on loopback by default. To share deliberately on your network:

```sh
npm --prefix docs run preview -- --host 0.0.0.0 --port 4176
```

The site uses one Sunset theme and no appearance toggle.
