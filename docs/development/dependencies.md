# Dependencies and known boundaries

The private root manifest defines the five npm workspaces and development tools. Each package manifest owns its runtime dependencies; the root lockfile resolves the complete development tree. Documentation has a separate manifest and lockfile. Distributable dependencies use package versions rather than another source checkout.

## Runtime and public declarations

| Package | Required dependencies | Optional peers |
| --- | --- | --- |
| `@jalsoedesign/dockline-abstract` | `@flystorage/file-storage` `1.2.2` for shared storage contracts | None |
| `@jalsoedesign/dockline-core` | `@jalsoedesign/dockline-abstract` `^1.0.0` | `@jalsoedesign/dockline-ftp-client` and `@jalsoedesign/dockline-sftp-client` `^1.0.0`; neither is automatically installed |
| `@jalsoedesign/dockline-ftp-client` | Abstract `^1.0.0`, storage contracts `1.2.2`, `basic-ftp` `6.2.1` | None |
| `@jalsoedesign/dockline-sftp-client` | Abstract `^1.0.0`, storage contracts `1.2.2`, `ssh2-sftp-client` `12.1.1`, `@types/ssh2-sftp-client` `9.0.6`, `@types/ssh2` `1.15.6` | None |
| `@jalsoedesign/dockline-cli` | `@jalsoedesign/dockline-core` `^1.0.0`, Commander `15.0.0`, YAML `2.9.1` | FTP and SFTP clients `^1.0.0` are optional peers; select the matching client explicitly |

Commander `15.0.0` and YAML `2.9.1` are production dependencies only of `@jalsoedesign/dockline-cli`. Installing core, abstract or a direct protocol client does not add either CLI dependency.

Abstract contains no FTP or SSH transport library. Core does not depend on either concrete client. An FTP-only application receives no SFTP/SSH runtime stack from these packages, and an SFTP-only application receives no FTP runtime stack. Direct clients do not depend on core or one another. The workspace development install contains all clients because it builds and tests all packages; that is different from a selected production installation.

The SFTP declaration packages are runtime dependencies of the SFTP client so production-only installations can compile its public types. Their versions do not need to match the runtime client major numerically; isolated declaration checks verify compatibility. Common configuration, SSH trust and interactive callback contracts live in abstract without importing concrete client declarations.

The shared storage package describes the adapter interface. The ordinary Dockline SDK does not instantiate its optional external storage wrapper. See the Windows normalization boundary below before adding that wrapper.

## Development and documentation

| Group | Packages / versions | Use |
| --- | --- | --- |
| Compiler | TypeScript `6.0.3`, Node types `22.20.2` | ESM/declaration builds and source/test type checks. |
| Test runner | Vitest `5.0.0`, Vite `8.3.0`, tsx `4.23.13` | Tests and TypeScript execution. |
| Protocol fixtures | `ftp-srv` `4.6.3`, `ssh2` `1.17.0` | Disposable local test servers; not a second application client stack. |
| Code/style | ESLint `10.10.0`, TypeScript ESLint `8.70.0`, Stylistic `5.10.0`, Stylelint `17.15.0` and their declared support packages | Shared four-space and vertical formatting contract. |
| Docs, separate installation | VitePress `1.6.4`, Vue `3.5.30`, Sass `1.104.0` | Markdown site and one Sunset theme. |

The FTP test server's UUID dependency is overridden to released `11.1.1`. The documentation installation overrides VitePress's Vite to released `6.4.3`. These are ordinary npm version overrides; dependency source is not modified. Recheck behavior when changing a version outside a parent's declared range.

Root `allowScripts` permits the required locked esbuild install script while optional CPU acceleration, tracing and SSH install scripts remain disabled. The documentation project's allowlist is separate. Review both manifests when changing native/build dependencies. A blocked install script is not evidence that a required binary was installed successfully.

## Dependency audits

Production and documentation dependencies have no known findings in the initial release checks. The full development installation has two high package entries for one test-server advisory. Run the commands below for current advisory data.

The full-root entries are `ftp-srv` and `ip`, one underlying advisory plus the affected parent. They belong to disposable test infrastructure. The full audit returns a nonzero status and is not represented as clean. Its suggested downgrade to an old FTP-server major is not a compatible repair.

The clean options are a maintained upstream test-server release or, in a separate change, replacing only test infrastructure with an independently maintained server. The runtime clients do not depend on this test server. Keep generated audit output outside the source tree and rerun online audits after dependency changes.

```sh
npm run audit:production
npm run audit:dependencies
npm run audit:docs
```

These commands explicitly request online advisory data even when a user-level npm configuration prefers offline installs. A cached/offline zero is not accepted as a current audit. Production checks and documentation checks cannot certify the full developer tree.

## Protocol correctness beyond advisories

### SFTP existence ambiguity

The installed SFTP dependency can convert a generic status 4 `lstat` failure into a missing-file result. Therefore `fileExists`/`directoryExists` can report false without confirmed absence in that case. Permission errors stay distinct only when the dependency preserves them. Applications should not authorize destructive recovery or synchronization from that result alone; use completed parent enumeration or other verified evidence where appropriate. This remains an upstream boundary, with no source patch applied.

### Optional storage-wrapper normalization on Windows

An application that separately adds the Flystorage wrapper also adopts its normalization and error behavior. Its default Windows path normalization has traversal/separator limitations. Dockline's normal SDK validates relative operation paths and does not instantiate that wrapper. Neither wrapping nor a configured remote root is a filesystem sandbox; select a verified normalizer and apply the application's own containment rules if adding the wrapper.

### Synthetic SSH key generation

The upstream SSH library's Ed25519 test-key generator can produce malformed fixture keys for leading-zero key material. Dynamic tests use valid RSA fixtures where the algorithm is incidental; a fixed valid Ed25519 fixture retains real Ed25519 authentication coverage. This is a test-fixture adjustment, not a protocol implementation patch or removal of supported user-provided keys. SSH-agent and key authentication remain covered by behavioral tests.

These correctness boundaries are independent of npm vulnerability counts. They remain documented until a compatible released dependency resolves them and the corresponding regressions verify the result.

## SSH client

The optional SSH workspace uses `ssh2` for command channels and the existing Dockline SFTP client for file transfers. It shares the Node version requirement and introduces no patches or forks. Application-specific configuration and prompt interfaces are supplied by callbacks.
