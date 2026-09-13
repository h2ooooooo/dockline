# @dockline/cli

The `dockline` terminal command for FTP, FTPS and SFTP: download, upload, list and remove files using a YAML connection. Part of [Dockline](https://github.com/h2ooooooo/dockline).

## Install

Registry commands require a published release. For a source checkout, use [build from source](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/installation.md#build-from-source).

### Global terminal command

```sh
npm i -g @dockline/cli @dockline/ftp-client @dockline/sftp-client
dockline --help
```

Keep only the FTP or SFTP client if one protocol is enough. The `dockline` command is available on your terminal's path after a global installation.

### Local project dependency

```sh
npm i @dockline/cli @dockline/sftp-client
npm exec -- dockline --help
```

Use `@dockline/ftp-client` instead for FTP/FTPS. In npm scripts, use `dockline` directly; from an ordinary terminal, prefix the commands below with `npm exec --` after a local install. Install the CLI and selected clients in the same location: a global CLI uses globally installed clients, while a local CLI uses its project's clients.

Core and abstract are required dependencies. Protocol clients are optional peers, so Dockline does not install either unless selected. Help and version work without a client or configuration file.

## Download a file

Create `dockline.server.yml`:

```yaml
version: 1
connection:
    protocol: ftp
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
```

Set the environment variables, then run the installed executable:

```sh
dockline download --source-file "/home/ftp/blabla.txt" --destination-file "blabla.txt" --config dockline.server.yml
```

The source is remote; the destination is local. Missing local parent directories are created. Downloads refuse to replace an existing local file unless `--overwrite replace` is selected. Use `ftps` or `ftps-implicit` when your server supports TLS.

## Everyday commands

```sh
dockline upload -s "./hello.txt" -d "/home/ftp/hello.txt"
dockline list -p "/home/ftp"
dockline list -p "/home/ftp" --recursive
dockline remove -p "/home/ftp/hello.txt"
dockline --help
```

Uploads replace by default, matching the SDK. SFTP supports `--overwrite fail`; portable FTP rejects that no-replace policy. Removing a nonempty directory requires `--recursive`. `--no-recursive` can override configured recursion. Recursive jobs default to 32 levels and 100000 examined entries; incomplete removal inventories are rejected before deletion, while failures during deletion can leave partial results. Remote root, dot, parent-traversal and symlink/special removal targets are refused.

`--config` defaults to `dockline.server.yml`. Advanced options live in YAML. Flags override command-specific YAML, then shared defaults, then connection operation settings. Local paths in YAML resolve from the config directory; local paths passed as flags resolve from the working directory. A leading `/` selects an absolute remote path.

SFTP uses managed host trust by default: interactive unknown-host approval can be remembered, unknown noninteractive hosts and changed keys are rejected. For automation, configure `connection.trust.fingerprint` with an independently verified fingerprint. Quiet mode still permits interactive host approval; JSON mode and piped runs do not prompt. The CLI does not prompt for passwords.

`--json` provides structured results for scripts; `--quiet` suppresses routine human output. Exit codes are `0` success, `1` transfer/connection error, `2` usage/configuration error and `130` cancellation. Cleanup completes before the executable exits.

See [commands](https://github.com/h2ooooooo/dockline/blob/main/docs/cli/commands.md), [configuration](https://github.com/h2ooooooo/dockline/blob/main/docs/cli/configuration.md), [CLI integration](https://github.com/h2ooooooo/dockline/blob/main/docs/guide/cli-integration.md) and the sample YAML files in this package's `examples/` directory.
