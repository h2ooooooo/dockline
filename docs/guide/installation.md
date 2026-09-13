# Installation

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and npm `>=12.0.2`. Dockline's packages are ESM and include declarations. There is no separate CommonJS build or browser transport.

Install `@dockline/core` plus the client for the protocols your application uses. Core alone installs shared infrastructure through `@dockline/abstract`, but neither transport client. The [package guide](/guide/packages) explains the boundaries.

## Install from npm

Choose the packages needed by your application. Install them from the public npm registry using their `@dockline/` package names.

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

## Installation examples

Npm resolves shared dependencies automatically. Install the CLI or core alongside the protocol clients you need.

### CLI with a protocol client

```sh
npm install @dockline/cli @dockline/ftp-client
```

This provides the `dockline` command with FTP/FTPS. For SFTP, replace `@dockline/ftp-client` with `@dockline/sftp-client`. Install both clients when needed. From a local npm installation run `npm exec -- dockline --help`; see the [CLI quick start](/guide/cli) for a YAML connection and real file commands. The CLI does not install a missing client automatically.

### Core only

```sh
npm install @dockline/core
```

This gives you the SDK, shared types, errors and tools. Creating a connection for an absent protocol client throws `MissingClientPackageError`; core does not download a transport automatically.

### FTP and FTPS

```sh
npm install @dockline/core @dockline/ftp-client
```

Continue with [Quick start FTP](/ftp/quick-start). This combination does not install the SFTP client or SSH transport stack.

### SFTP

```sh
npm install @dockline/core @dockline/sftp-client
```

Continue with [Quick start SFTP](/sftp/quick-start). This combination does not install the FTP client or `basic-ftp`.

### Both protocol clients

```sh
npm install @dockline/core @dockline/ftp-client @dockline/sftp-client
```

The same `Dockline` API now supports FTP, FTPS and SFTP. Core selects the installed client from the configuration's `protocol`.

### A direct client without core

```sh
npm install @dockline/ftp-client
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

Install and import from `@dockline/sftp-client` for the equivalent SSH adapter; configure [host trust](/guide/trust) explicitly. Direct clients expose `FtpConnector` or `SftpConnector` as well as their factory. They do not include core's local `uploadFile()`/`downloadFile()` convenience wrapper. See [FTP](/guide/ftp) and [SFTP](/guide/sftp) for low-level configuration and methods.

## TypeScript and JavaScript

```ts
import {Dockline, type TransferConfig} from '@dockline/core';
import {ConnectorPool} from '@dockline/abstract';
import {FtpConnector} from '@dockline/ftp-client';
import {SftpConnector, KnownHostsStore} from '@dockline/sftp-client';
```

Only import concrete clients your application installs. Core re-exports generic shared types and helpers, so an SDK user can also import `ConnectorPool` from `@dockline/core`. It does not re-export concrete adapters or `KnownHostsStore`.

Use `module` and `moduleResolution` set to `NodeNext` in a Node TypeScript application, and `"type": "module"` in its package manifest. CommonJS callers can use dynamic `import()`.

## Contributing and building documentation

To work on Dockline itself, follow [the source build guide](/development/compiler#build-from-source). In that checkout, documentation has its own manifest and lockfile so VitePress is not a runtime dependency:

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
