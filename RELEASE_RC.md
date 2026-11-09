# First release candidate

Historical prerelease notes. See [Stable release](RELEASE.md) for the current stable versions.

This release uses the `rc` npm tag. Existing stable `latest` tags remain unchanged. Install this candidate explicitly:

```sh
npm install @jalsoedesign/dockline-abstract@rc @jalsoedesign/dockline-cli@rc @jalsoedesign/dockline-core@rc @jalsoedesign/dockline-ftp-client@rc @jalsoedesign/dockline-keys@rc @jalsoedesign/dockline-sftp-client@rc @jalsoedesign/dockline-ssh-client@rc
```

| Package | Candidate |
| --- | --- |
| `@jalsoedesign/dockline-abstract` | `1.1.0-rc.1` |
| `@jalsoedesign/dockline-cli` | `1.1.0-rc.1` |
| `@jalsoedesign/dockline-core` | `1.1.0-rc.1` |
| `@jalsoedesign/dockline-ftp-client` | `1.1.0-rc.1` |
| `@jalsoedesign/dockline-keys` | `1.0.0-rc.1` |
| `@jalsoedesign/dockline-sftp-client` | `1.1.0-rc.1` |
| `@jalsoedesign/dockline-ssh-client` | `1.1.0-rc.1` |

Family dependencies explicitly include the candidate versions. A stable range such as `^1.0.0` does not accept `1.0.0-rc.1`.

Saved profiles use the shared `@jalsoedesign/portline-dockline` execution bridge. Install the FTP, SFTP or SSH Dockline handler required by the operation. Reader packages continue to work without execution handlers.

For SSH and SFTP through the bridge, an interactive terminal asks you to confirm unknown fingerprints by default. Explicit pins and trust callbacks take priority. Unattended jobs require configured trust. Default bridge approvals last for that bridge instance and are not written to disk.
