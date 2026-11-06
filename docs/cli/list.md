# list

## Run this command

First follow [CLI setup](/cli/quick-start), saving the connection as `server.yml`. The command below uses that connection. The [local FTP fixture](/guide/local-demo#ftp) captures the 21-byte example output shown here without requiring an external server. Its directory contents are controlled; an existing server can return different entries and paths.

After [uploading the sample](/cli/upload), the server contains `hello.txt` with 21 bytes.

The selected directory `.` is on the server. This command only reads entries.

```sh
dockline list --path . --config server.yml --json
```

## Get this output

Exit code: `0`. JSON is written to stdout without terminal colours or progress. Temporary absolute paths are shown as `<temporary-directory>`; actual values depend on the machine.

```json
{
    "ok": true,
    "command": "list",
    "path": ".",
    "entries": [
        {
            "path": "./hello.txt",
            "type": "file",
            "size": 21
        }
    ],
    "complete": true
}
```

## Defaults and options

Listing is shallow by default. `--recursive` uses bounded traversal; `--no-recursive` overrides YAML recursion. An incomplete inventory fails instead of reporting a successful complete result. Order and optional timestamps vary by server.

Flags override YAML command/default values. Local flag paths are relative to your working directory; YAML local paths are relative to its file. Remote paths use the configured root, with absolute remote paths translated by the CLI. See [the complete list options](/cli/commands#list).

## Human output and failures

Omit `--json` for [human output](/cli/output). Dockline currently prints plain transfer/list text; the docs do not add colours the executable does not emit. `--quiet` suppresses routine success/progress, but retains listing data and errors. `--json` takes precedence.

Usage/configuration errors exit `2`; connection, trust and operation failures exit `1`; cancellation exits `130`. [Output contracts](/cli/output#errors-streams-and-exit-codes) explain stdout/stderr and the failure object. [Troubleshooting](/cli/troubleshooting) covers recovery.

Next: [download the sample](/cli/download).
