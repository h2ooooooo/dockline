# Stable release

Install the current stable packages from npm:

```sh
npm install @jalsoedesign/dockline-abstract @jalsoedesign/dockline-cli @jalsoedesign/dockline-core @jalsoedesign/dockline-ftp-client @jalsoedesign/dockline-keys @jalsoedesign/dockline-sftp-client @jalsoedesign/dockline-ssh-client
```

| Package | Version |
| --- | --- |
| `@jalsoedesign/dockline-abstract` | `1.1.0` |
| `@jalsoedesign/dockline-cli` | `1.1.0` |
| `@jalsoedesign/dockline-core` | `1.1.0` |
| `@jalsoedesign/dockline-ftp-client` | `1.1.0` |
| `@jalsoedesign/dockline-keys` | `1.0.0` |
| `@jalsoedesign/dockline-sftp-client` | `1.1.0` |
| `@jalsoedesign/dockline-ssh-client` | `1.1.0` |

## Compatibility and updates

Dependencies and optional protocol peers between these libraries use caret ranges, such as `^1.0.0` and `^1.1.0`. Compatible fixes and additions use patch and minor releases. Breaking public API or behavior changes require a new major version.

Caret ranges allow compatible stable updates. Use `npm update` to refresh installed versions within those ranges. Existing lockfiles retain their selected versions; `npm ci` reproduces the lockfile. Published prereleases remain available through the `rc` tag and explicit prerelease versions.

The shared `@jalsoedesign/portline-dockline` bridge executes saved profiles. Install the FTP, SFTP or SSH Dockline handler required by the operation. Reader packages work without execution handlers.

For SSH and SFTP, an interactive terminal asks you to confirm unknown fingerprints by default. Explicit pins and trust callbacks take priority. Unattended jobs require configured trust. Default bridge approvals last for that bridge instance and are not written to disk.
