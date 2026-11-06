# Your first terminal transfer

Install Dockline, save a connection file and run a directory listing. Then upload and download one small file. You need an SFTP account and a verified server fingerprint; [try the local demo](/guide/local-demo) if you do not have them yet.

## Install

```sh
npm install --global @jalsoedesign/dockline-cli @jalsoedesign/dockline-sftp-client
dockline --help
```

Install the CLI and protocol client together. Prefer a project-local installation? Use `npm install` without `--global` and prefix subsequent commands with `npm exec --`.

## Save dockline.server.yml

Create this file in your current directory. It references environment variables rather than storing the password in YAML.

```yaml
version: 1
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    password: ${SFTP_PASSWORD}
    trust:
        fingerprint: ${SFTP_SHA256}
```

Set your own values in the same terminal. Obtain the fingerprint through a trusted channel; it is not your private authentication key.

::: code-group

```powershell [PowerShell]
$env:SFTP_HOST = "files.example.com"
$env:SFTP_USERNAME = "deploy"
$env:SFTP_PASSWORD = "your-password"
$env:SFTP_SHA256 = "SHA256:your-verified-server-fingerprint"
```

```sh [macOS / Linux]
export SFTP_HOST="files.example.com"
export SFTP_USERNAME="deploy"
export SFTP_PASSWORD="your-password"
export SFTP_SHA256="SHA256:your-verified-server-fingerprint"
```

:::

## List the server directory

```sh
dockline list --path .
```

Example human output, which varies with your server's files:

```text
directory	-	reports
file	21	hello.txt
```

Columns are type, size and path. Dockline reads `dockline.server.yml` automatically; the command succeeds with exit code `0`. A listing does not change remote files.

## Upload a file

Create the same short input in either shell:

::: code-group

```powershell [PowerShell]
Set-Content -LiteralPath hello.txt -Value "Hello from Dockline!" -NoNewline
```

```sh [macOS / Linux]
printf 'Hello from Dockline!' > hello.txt
```

:::

This creates a 20-byte ASCII file. Choose a writable remote filename you intend to replace:

```sh
dockline upload --source-file hello.txt --destination-file dockline-hello.txt
```

For this input and a successful connection, output on Windows is shown below. `<working-directory>` stands for the actual absolute directory; macOS/Linux use `/` path separators:

```text
Uploaded 20 bytes: <working-directory>\hello.txt -> dockline-hello.txt
```

Ordinary uploads replace the remote filename. SFTP supports `--overwrite fail` when the destination must be new.

## Download it again

```sh
dockline download --source-file dockline-hello.txt --destination-file downloaded-hello.txt
```

Windows output for the same 20-byte input, with the absolute local path abbreviated:

```text
Downloaded 20 bytes: dockline-hello.txt -> <working-directory>\downloaded-hello.txt
```

Downloads refuse to replace an existing local file. To repeat deliberately, add `--overwrite replace` or choose a fresh destination. Local flag paths are relative to your terminal's current directory; remote paths are relative to the configured starting directory.

## Use the result in a script

Add `--json` to get machine-readable output without progress mixed into stdout:

```sh
dockline upload --source-file hello.txt --destination-file dockline-hello.txt --json
```

The success object contains `ok`, `command`, `sourceFile`, `destinationFile` and `bytesTransferred`. Local paths in JSON are resolved absolute paths. Always check the process exit status. See [JSON and failures](/cli/output) for the complete contract.

## Next steps

Use [private keys](/cli/configuration#sftp-trust-and-credentials), configure a [remote root or retry limits](/cli/configuration), or select FTP/FTPS by installing `@jalsoedesign/dockline-ftp-client` and changing the protocol/configuration. [Command reference](/cli/commands) documents exact flags and overwrite behavior; [troubleshooting](/cli/troubleshooting) covers connection failures.
