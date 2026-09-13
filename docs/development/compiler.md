# Compiler and package build

Dockline is a TypeScript monorepo that emits five ESM packages. The root is private and coordinates the workspaces; it is not a distributable SDK package. Builds use the compiler installed in this repository.

## Build from source

Clone [h2ooooooo/dockline](https://github.com/h2ooooooo/dockline) to contribute to the packages or documentation:

```sh
git clone https://github.com/h2ooooooo/dockline.git
cd dockline
npm ci
npm run build
```

The root is a private workspace. Applications should use [npm package installation](/guide/installation). Run the package and isolated-consumer checks below to validate distribution artifacts before publishing.

## Source and output

The packages live under `packages/abstract`, `packages/core`, `packages/ftp-client`, `packages/sftp-client` and `packages/cli`. Each owns `src/`, `tests/`, its package manifest and generated `dist/`. Shared compiler settings target ES2022 with `NodeNext` modules and module resolution, strict checking, JavaScript source maps, declarations and declaration maps. Source imports use `.js` specifiers for relative emitted modules and package names across workspace boundaries.

Abstract builds before its dependents. Core builds against abstract's structural contracts; its source and declarations do not statically import concrete clients. Each client builds against abstract and its own transport dependencies. Test type checking includes each package's source and tests without emitting test output.

The isolated consumer check compiles public declarations with `skipLibCheck: false`. A successful source build alone cannot prove that another project can use a tarball's types or load its optional client correctly.

## Commands

| Command | Result |
| --- | --- |
| `npm ci` | Installs the root lockfile and links the five local workspaces. |
| `npm run build` | Builds all packages in dependency order with the local compiler. |
| `npm run dev` | Runs the declared workspace development/watch workflow. |
| `npm run typecheck` | Checks package source and test types. |
| `npm run check:packages` | Checks each package's tarball inventory, public targets and portable dependency metadata. |
| `npm run check:consumer` | Installs tarballs into isolated consumers and checks package combinations, loading and public types. |
| `npm pack --workspaces` | Creates one tarball per publishable workspace. |
| `npm run docs:install` | Installs the independently locked documentation project. |
| `npm run docs:build` | Builds VitePress into `docs/.vitepress/dist/`. |

Builds validate their owned output directories before replacing generated files. Do not run a clean build concurrently with a test, package check or linked consumer reading those outputs. A build does not publish packages or install a missing optional client.

Linked applications load package `dist/` entries and need a rebuild after source changes. They should reference selected workspace folders, not the private repository root. Installing released packages from npm removes that source-checkout requirement.

## Package contents and metadata

Each public package exposes its own root ESM/declaration entry point and package metadata. The distribution includes generated output, source needed by source/declaration maps, its README, license and manifest. Tests, dependency installations, scratch data and Git metadata are excluded.

Cross-package runtime dependencies use version ranges, not `file:../` references. Npm workspaces satisfy those ranges locally. The isolated-consumer checks install locally packed abstract, core and selected clients together to validate their dependency relationships. One package's tarball does not contain sibling source code.

Core depends on `@dockline/abstract`; the FTP and SFTP packages are optional peers. Its client selection is synchronous so `new Dockline`, `Dockline.create` and `createConnector` preserve their signatures. The loader uses Node's module resolution from the installed core package and selects only the requested installed client. Missing optional clients receive the dedicated error; errors from a broken present client propagate. The supported Node floor is part of this loading contract.

Declaration dependencies belong to the package whose public declarations use them. An installed client must have the types needed by its public API even after a production-only install. Abstract and core must remain compilable without requiring either concrete client. The consumer matrix verifies these boundaries instead of relying on workspace hoisting.

The five package versions can change independently. When abstract contracts or client compatibility change, update affected dependency/optional-peer ranges together. The private root's version is workspace metadata and is not a registry release.

## CLI executable

`@dockline/cli` declares the `dockline` executable and a separate package root API for embedding. Its compiled entry point preserves the Node shebang. The executable handles terminal signals and invokes the same command runner exposed to applications; it does not vendor the FTP or SFTP clients. YAML examples ship with the CLI package.

Commander handles command parsing and YAML handles the configuration syntax. The runtime still selects only an installed client through core. Distribution checks must exercise the installed executable, help/version without configuration or clients, and real commands with selected protocol tarballs.

## Documentation build

The `docs/` folder is a private npm project with its own manifest, lockfile and dependencies. Root `docs:*` commands delegate into it. VitePress renders Markdown with local search and a single Sunset theme; `appearance: false` removes the theme switch. Navigation documents packages, separate FTP/SFTP quick starts, the shared API and development.

Documentation output is separate from package tarballs. Building or previewing it does not open a transfer or publish a site. The root workspace and separately installed documentation tree both need their own validation and audit.
