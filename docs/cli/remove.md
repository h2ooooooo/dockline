# remove

## Run this command

First follow [CLI setup](/cli/quick-start), saving the connection as `server.yml`. The command below uses that connection. The [local FTP fixture](/guide/local-demo#ftp) captures the 21-byte example output shown here without requiring an external server. Its directory contents are controlled; an existing server can return different entries and paths.

After [uploading the sample](/cli/upload), the server contains `hello.txt` with 21 bytes.

This deletes `hello.txt` on the server. Run it after downloading or inspecting the sample.

```sh
dockline remove --path hello.txt --config server.yml --json
```

## Get this output

Exit code: `0`. JSON is written to stdout without terminal colours or progress. Temporary absolute paths are shown as `<temporary-directory>`; actual values depend on the machine.

```json
{
    "ok": true,
    "command": "remove",
    "path": "hello.txt",
    "removed": 1
}
```

## Defaults and options

This deletes the selected remote entry. Nonempty directories require `--recursive`. Root, dot, traversal and symlink/special-file targets are refused. Recursive removal inventories first, but later deletion failures do not roll back completed deletions.

Flags override YAML command/default values. Local flag paths are relative to your working directory; YAML local paths are relative to its file. Remote paths use the configured root, with absolute remote paths translated by the CLI. See [the complete remove options](/cli/commands#remove).

## Human output and failures

Omit `--json` for [human output](/cli/output). Dockline currently prints plain transfer/list text; the docs do not add colours the executable does not emit. `--quiet` suppresses routine success/progress, but retains listing data and errors. `--json` takes precedence.

Usage/configuration errors exit `2`; connection, trust and operation failures exit `1`; cancellation exits `130`. [Output contracts](/cli/output#errors-streams-and-exit-codes) explain stdout/stderr and the failure object. [Troubleshooting](/cli/troubleshooting) covers recovery.

Next: [script around output and exit codes](/cli/output).
