# Testing and documentation maintenance

Tests verify ordinary use and the failure boundaries that determine whether a caller can trust a transfer result. They use generated content, synthetic credentials, controlled streams and disposable local FTP/FTPS/SFTP servers. No customer server, real vault or saved account is required.

## Full workspace gate

From the repository root, use the declared Node/npm toolchain:

```sh
npm ci
npm run check:repository
npm run lint
npm run typecheck
npm test
npm run build
npm run check:packages
npm run check:consumer
npm run docs:install
npm run docs:build
npm run audit:production
npm run audit:docs
```

Run `npm run audit:dependencies` separately to include the known development-only test-server finding; see [dependencies](./dependencies.md). The CI workflow under `.github/workflows/ci.yml` records the automated gate. Do not hide developer findings with an audit threshold or present production-only checks as a complete audit.

`npm test` builds the workspaces and runs Vitest over `packages/*/tests/`. `npm run typecheck` builds dependencies and checks each package's source and test types. `npm run test:style` runs the local formatting-rule regressions. For focused work use `npm test -- packages/core/tests/path/to/file.test.ts` with an actual test filename. Check each package's `tests/` directory for its focused suites.

## Behavioral coverage

| Area | Important assertions |
| --- | --- |
| SDK configuration and paths | Protocol/port validation, defaults, relative roots, traversal/control rejection and the exported entry points. |
| Connection ownership | Scoped success/failure cleanup, combined errors, explicit sessions and serialization without credentials. |
| Local file helpers | Replayable upload sources, direct versus no-replace policies, staged downloads, unlimited size defaults, explicit byte limits, aborts, overwrite protection and owned cleanup. |
| FTP/FTPS | Passive sessions, explicit/implicit certificate verification, final control acknowledgement, streaming and error distinctions. |
| SFTP | Host-key rejection, passwords, encrypted/private keys, agents, interactive exchanges and permission behavior. |
| Providers and observers | Cancelled/late callbacks, credential redaction, explicit authentication mode, keepalive and observer failures. |
| Progress and bandwidth | Actual streamed bytes, optional connector/call size limits, attempt reset, terminal events, cancellation, aggregate directions and backpressure. |
| Transfer helpers | Validated policy before mutation, exclusive staging, verification, uncertain final rename, owned cleanup, unlimited copy/checksum defaults, explicit byte budgets and traversal completion. |
| Pools | Metadata and transfers share a quota; FIFO, slow creation, streams/iterators, late outcomes, explicit lease release and forced shutdown. |
| Known hosts | Explicit approval, exact host/port/key identity, changed keys, serialization, locking and concurrent conflicts. |
| Packaging | Five ESM/declaration entry points and the CLI executable, independent tarball contents, portable dependencies, optional peers and independently installed consumer combinations. |
| Client loading | Core-only imports, matching protocol selection, synchronous construction, missing-client details, original errors from broken clients and no automatic installation/fallback. |

The workspace gate checks each package's real distribution boundary. Tests importing source alone cannot prove that npm consumers receive the required runtime files and declaration dependencies. Build before package checks, and do not run another clean build while a consumer is reading `dist/`.

Current size-limit regressions stream a download and transfer monitor above 1 GiB without allocating a whole file in memory. Checksum/copy regressions supply metadata above that threshold and confirm streaming proceeds to the ordinary integrity checks instead of an implicit size rejection. Additional cases cover explicit connector/call limits, `Infinity` overrides, empty files, invalid limits and partial-transfer cleanup. Unlimited size must not weaken completion or integrity checks. Keep these assertions independent of package versions and release dates.

## Fixture boundaries

Protocol endpoints bind locally and use disposable state. FTP and SFTP data/metadata responses must represent the same synthetic filesystem. Empty or malformed directory descriptions can legitimately be rejected as unsupported entries and are not substitutes for valid-server fixtures.

Generated SSH keys must be accepted by the installed transport implementation. The affected upstream Ed25519 synthetic-generator path uses RSA fixtures where algorithm choice is incidental; this avoids a flaky generator without patching external source. Authentication behavior is still exercised. Tests involving Windows named pipes or filesystem operations reflect the current local environment; do not claim every host or server dialect is certified.

A fixed valid Ed25519 fixture retains actual Ed25519 authentication coverage. Windows trust-store tests also cover `EPERM` during lock contention: waiting is bounded, persistent failure preserves the original error, and an existing lock is never silently taken over.

Resource tests should close sessions, listeners, streams and temporary files even on failure. Never replace synthetic secrets with user credentials to make a test pass. Fault injection belongs in owned test doubles or local fixtures.

## Consumer installation matrix

The package check inspects every tarball. The library portion of the isolated-consumer check covers seven installations: abstract only, core only, a direct FTP client, a direct SFTP client, core with FTP, core with SFTP, and core with both clients. It verifies required dependency closure, optional-client isolation, shared error identities, runtime imports and public declarations. Production checks must use installed tarballs rather than source aliases or workspace hoisting.

Core-only tests exercise missing-client failures without opening a network connection. A present client that throws or has a broken dependency must preserve that original error; an incompatible client export is reported as an interface failure. Tests must not turn that case into a misleading installation suggestion.

## Protocol quick-start checks

The current consumer check reads the actual [FTP](../ftp/quick-start.md) and [SFTP](../sftp/quick-start.md) Markdown pages. It compiles each complete opening example, then each recipe in an async function with that example's connection and imports available. Every TypeScript block is checked against installed core and its matching client tarballs with `skipLibCheck: false`; the README example remains covered. These checks compile examples without connecting to the example servers or transferring files.

## CLI verification

The consumer matrix adds CLI only, CLI with FTP and CLI with SFTP to the existing seven library combinations, for ten installations in total. CLI-only help/version must work without a YAML file or clients; an actual connection must identify a missing required client. The CLI needs configuration and command tests in addition to SDK transfer coverage. Check option precedence, relative/absolute path handling, environment expansion, malformed YAML, credential/trust policy, overwrite defaults, recursive completion, JSON output and exit codes. Its package checks exercise the compiled executable outside the checkout, including help/version without YAML or clients and commands with only their selected protocol package.

The same check installs the CLI into three isolated global prefixes: CLI alone, CLI with FTP and CLI with SFTP. It checks generated executable shims, help/version and optional-client resolution outside the source checkout.

Run CLI configuration, parsing, trust and protocol integration tests alongside the SDK regressions. Installed-package checks verify the executable independently of workspace links.

## VitePress workflow

The `docs/` directory is a separate npm project. After `npm run docs:install`, use:

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Markdown pages cover package selection/layout, installation, protocol quick starts, configuration, usage, CLI integration, protocol details, trust, pools, advanced transfers, errors, the public API, component/specification behavior, compiler and dependencies. The VitePress config defines navigation and local search. Its theme uses one fixed Sunset palette with no appearance switch.

Update the relevant Markdown page whenever an exported method, default, guarantee, supported dependency or limitation changes. Document implemented behavior before ideas. Keep source examples aligned with the public package imports, and compile important examples through the isolated consumer or dedicated tests.

`npm run docs:build` checks Markdown rendering and internal page links. When navigation, search or theme changes, inspect the built site as well. The docs build does not replace package type checking or protocol tests. Rebuild/reload preview after output changes. Keep local audit output and generated verification records outside the source repository.
