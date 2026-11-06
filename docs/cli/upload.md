# upload

## Run this command

First follow [CLI setup](/cli/quick-start), saving the connection as `server.yml`. The command below uses that connection. The [local FTP fixture](/guide/local-demo#ftp) captures the 21-byte example output shown here without requiring an external server. Its directory contents are controlled; an existing server can return different entries and paths.

Create host source `input.txt` containing `Hello from Dockline!` followed by a newline (21 ASCII bytes). The destination `hello.txt` is on the server; ordinary uploads replace it.

::: code-group

```powershell [PowerShell]
Set-Content -LiteralPath input.txt -Value "Hello from Dockline!`n" -NoNewline
```

```sh [macOS / Linux]
printf 'Hello from Dockline!\n' > input.txt
```

:::

```sh
dockline upload -s input.txt -d hello.txt --config server.yml --json
```

## Get this output

Exit code: `0`. JSON is written to stdout without terminal colours or progress. Temporary absolute paths are shown as `<temporary-directory>`; actual values depend on the machine.

```json
{
    "ok": true,
    "command": "upload",
    "sourceFile": "<temporary-directory>\\input.txt",
    "destinationFile": "hello.txt",
    "bytesTransferred": 21
}
```

## Defaults and options

The local source must be a regular file and the remote parent must exist. Upload defaults to replacement and can leave partial remote content after interruption. SFTP supports `--overwrite fail`; FTP/FTPS refuse that guarantee before connecting.

Flags override YAML command/default values. Local flag paths are relative to your working directory; YAML local paths are relative to its file. Remote paths use the configured root, with absolute remote paths translated by the CLI. See [the complete upload options](/cli/commands#upload).

## Human output and failures

Omit `--json` for [human output](/cli/output). Dockline currently prints plain transfer/list text; the docs do not add colours the executable does not emit. `--quiet` suppresses routine success/progress, but retains listing data and errors. `--json` takes precedence.

Usage/configuration errors exit `2`; connection, trust and operation failures exit `1`; cancellation exits `130`. [Output contracts](/cli/output#errors-streams-and-exit-codes) explain stdout/stderr and the failure object. [Troubleshooting](/cli/troubleshooting) covers recovery.

Next: [list the sample](/cli/list).
