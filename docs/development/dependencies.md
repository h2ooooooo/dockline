# Dependencies and known boundaries

The private root manifest defines the seven npm workspaces and development tools. Each package manifest owns its runtime dependencies; the root lockfile resolves the complete development tree. Documentation has a separate manifest and lockfile. Distributable dependencies use package versions rather than another source checkout.

## Runtime and public declarations

| Package | Required dependencies | Optional peers |
| --- | --- | --- |
| `@jalsoedesign/dockline-abstract` | `@flystorage/file-storage` | None |
| `@jalsoedesign/dockline-cli` | `@jalsoedesign/dockline-core`, `commander`, `yaml` | `@jalsoedesign/dockline-ftp-client`, `@jalsoedesign/dockline-sftp-client` |
| `@jalsoedesign/dockline-core` | `@jalsoedesign/dockline-abstract` | `@jalsoedesign/dockline-ftp-client`, `@jalsoedesign/dockline-sftp-client` |
| `@jalsoedesign/dockline-ftp-client` | `@jalsoedesign/dockline-abstract`, `@flystorage/file-storage`, `basic-ftp` | None |
| `@jalsoedesign/dockline-keys` | `@jalsoedesign/dockline-abstract`, `sshpk`, `hash-wasm` | None |
| `@jalsoedesign/dockline-sftp-client` | `@jalsoedesign/dockline-abstract`, `@flystorage/file-storage`, `@types/ssh2`, `@types/ssh2-sftp-client`, `ssh2-sftp-client`, `ssh2`, `@jalsoedesign/dockline-keys` | None |
| `@jalsoedesign/dockline-ssh-client` | `@jalsoedesign/dockline-sftp-client`, `ssh2`, `@types/ssh2`, `@jalsoedesign/dockline-keys` | None |

Commander `15.0.0` and YAML `2.9.1` are production dependencies only of `@jalsoedesign/dockline-cli`. Installing core, abstract or a direct protocol client does not add either CLI dependency.

Abstract contains no FTP or SSH transport library. Core does not depend on either concrete client. An FTP-only application receives no SFTP/SSH runtime stack from these packages, and an SFTP-only application receives no FTP runtime stack. FTP and SFTP clients do not depend on core or one another. The SSH command client reuses SFTP for its file helpers and uses ssh2 for execution. Both SSH/SFTP delegate key parsing to dockline-keys; keys has no transport dependency. The workspace development install contains all clients because it builds and tests all packages; that is different from a selected production installation.

The SFTP declaration packages are runtime dependencies of the SFTP client so production-only installations can compile its public types. Their versions do not need to match the runtime client major numerically; isolated declaration checks verify compatibility. Common configuration, SSH trust and interactive callback contracts live in abstract without importing concrete client declarations.

The shared storage package describes the adapter interface. The ordinary Dockline SDK does not instantiate its optional external storage wrapper. See the Windows normalization boundary below before adding that wrapper.

## Development and documentation

| Group | Packages | Use |
| --- | --- | --- |
| Compiler | TypeScript and Node types | ESM/declaration builds and source/test type checks. |
| Test runner | Vitest, Vite and tsx | Tests and TypeScript execution. |
| Protocol fixtures | `ftp-srv` and `ssh2` | Disposable local endpoints, outside published transport runtime dependencies. |
| Code/style | ESLint, typescript-eslint, Stylistic and Stylelint | Shared coding/formatting contract. |
| Documentation | VitePress, Vue and Sass | Private, separately installed Markdown site. |

Exact versions belong to the root, package and documentation manifests and their lockfiles; these tables do not maintain a second version list.

The FTP test server's UUID dependency is overridden to released `11.1.1`. The documentation installation overrides VitePress's Vite to the released version declared in its manifest. These are ordinary npm version overrides; dependency source is not modified. Recheck behavior when changing a version outside a parent's declared range.

Root `allowScripts` permits the required locked esbuild install script while optional CPU acceleration, tracing and SSH install scripts remain disabled. The documentation project's allowlist is separate. Review both manifests when changing native/build dependencies. A blocked install script is not evidence that a required binary was installed successfully.

## Dependency audits

Audit results are time-specific. Run production, documentation and full development checks separately and retain their actual results. A clean result for one tree does not establish that every tree is clean.

The FTP test server and its transitive dependencies belong to disposable development infrastructure, not the published transport runtime. Review that boundary when an advisory is reported. Do not apply an incompatible major downgrade automatically; validate any dependency or fixture replacement with the protocol tests. Keep generated audit reports outside public source.

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

## Saved settings integration

The optional Portline–Dockline bridge is a separate Portline package. It requires core/abstract contracts and declares FTP, SFTP and SSH clients as optional peers. Reader packages need no protocol dependencies. Dockline packages remain independently usable with ordinary configuration. Native credential/trust sources are separate from runtime callbacks and transport sessions; [saved-profile integration](/guide/saved-profiles) describes the boundaries.

## Verify unpublished dependencies

Normal checkouts use `npm ci --ignore-scripts` and public npm dependency ranges. Before dependency versions are published, collect their verified packages with `npm run pack:local -- --output /path/to/artifacts`. Keep the package inventories beside the tarballs. No sibling checkout layout is required.

```sh
npm run release:lock -- --artifacts /path/to/artifacts
npm run check:locks
npm run test:locks
npm run check:bootstrap -- --artifacts /path/to/artifacts
```

The lock command uses real package metadata and SHA-512 hashes from those artifacts, retaining canonical public npm URLs. The bootstrap check creates a disposable checkout, installs locked versions through a temporary read-only registry, and runs builds, lint, tests and available API/example checks. It does not change npm user configuration or relax remote-package restrictions. Node.js, the repository's declared npm version and the system `tar` command must be available.

This verifies candidate payloads, not their availability on npm. Publish the exact verified tarballs in dependency order; if a package changes, repack it, regenerate downstream locks and repeat the checks. Once dependencies are available publicly, verify a fresh `npm ci --ignore-scripts` without bootstrap and compare registry integrity with the reviewed artifacts.

## Stable releases and compatibility

Keep dependencies and optional peers between the published family packages on stable caret ranges, such as `^1.0.0`. Preserve existing public APIs and supported behavior throughout a major version. Release compatible fixes as patch versions and compatible additions as minor versions. Breaking changes require a new major version. Raise a dependency minimum only when the implementation needs a newer supported API or fix.

Caret ranges permit compatible updates. Consumers can use `npm update` to refresh their lockfiles within those ranges; `npm ci` continues to reproduce the versions already locked.
