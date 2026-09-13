# Dockline CLI

`@dockline/cli` provides the `dockline` command for downloading, uploading, listing and removing remote files. Server settings live in YAML; everyday file choices stay on the command line. Install only the FTP or SFTP client you need.

## Install

Registry commands require a published release. For a source checkout, use [build from source](/guide/installation#build-from-source).

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

## Download your first file

Create `dockline.server.yml` in your working directory:

```yaml
version: 1
connection:
    protocol: ftp
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
```

Set those environment variables to your server's settings, then run:

```sh
dockline download --source-file "/home/ftp/blabla.txt" --destination-file "blabla.txt" --config dockline.server.yml
```

This fetches `/home/ftp/blabla.txt` from the remote server and saves it as `blabla.txt` in your working directory. Dockline creates missing local parent directories. Downloads refuse to replace an existing local file unless you pass `--overwrite replace`.

The default configuration filename is `dockline.server.yml`, so you can shorten the same command:

```sh
dockline download -s "/home/ftp/blabla.txt" -d "blabla.txt"
```

Plain FTP is unencrypted. If your server supports FTP over TLS, set `protocol: ftps` for explicit TLS or `protocol: ftps-implicit` for implicit TLS. Certificate verification remains enabled. The commands stay the same.

## Upload, list and remove

Upload a local file to the server:

```sh
dockline upload -s "./hello.txt" -d "/home/ftp/hello.txt"
```

Uploads replace the remote destination by default, matching the SDK. An ordinary interrupted upload can leave partial remote content. SFTP supports `--overwrite fail` for a staged no-replace upload; portable FTP cannot guarantee that policy and rejects it before connecting.

List a directory, then include its descendants:

```sh
dockline list --path "/home/ftp"
dockline list --path "/home/ftp" --recursive
```

Remove the example file when you are finished:

```sh
dockline remove --path "/home/ftp/hello.txt"
```

`remove` deletes the selected file or an empty directory. Removing a nonempty directory requires `--recursive`. See [command details](/cli/commands) for deletion boundaries and recursive listing results.

## Use SFTP

Install the SFTP client and change the YAML connection:

```yaml
version: 1
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    password: ${SFTP_PASSWORD}
```

With no explicit trust setting, an interactive terminal can ask you to approve an unfamiliar server key and remember the decision in `~/.dockline/known-hosts.json`. A changed key is rejected. Quiet mode still permits that interactive approval. JSON mode and piped/noninteractive runs do not prompt; an unknown host is rejected rather than approved automatically. The CLI does not prompt for passwords; supply credentials through configuration, environment variables, a key or a selected SSH agent.

For unattended use, provide an independently verified fingerprint:

```yaml
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    password: ${SFTP_PASSWORD}
    trust:
        fingerprint: ${SFTP_SHA256}
```

Use the same `download`, `upload`, `list` and `remove` commands. See [SSH trust and credentials](/cli/configuration#sftp-trust-and-credentials) for the exact policy and file locations.

## Save repeated choices in YAML

```yaml
version: 1
connection:
    protocol: ftps
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
    root: /home/ftp
    timeoutMs: 60000
    autoReconnect: true
    maxTransientRetries: 3
commands:
    download:
        sourceFile: reports/latest.csv
        destinationFile: downloads/latest.csv
```

Now `dockline download` uses the configured paths. A command-line value overrides the corresponding YAML value. Local paths written in YAML are relative to the configuration file; local paths passed as flags are relative to your working directory. Remote relative paths use `connection.root`; a leading `/` explicitly selects an absolute remote path.

Retries, timeouts, size limits, bandwidth, TLS and other advanced choices belong in [configuration](/cli/configuration), keeping the command flags focused on ordinary file work.

## Help and scripting

```sh
dockline --help
dockline download --help
dockline --version
dockline list --path "/home/ftp" --json
```

Help and version work without a YAML file or installed protocol client. `--json` provides structured output for scripts, with no progress mixed into standard output. [Command reference](/cli/commands#output-and-exit-codes) describes output and exit codes.

To build your own application command, see [CLI integration](/guide/cli-integration). Core's transfer API remains usable without the packaged CLI.
