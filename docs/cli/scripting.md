# Shell scripting

Use `--json` when another program consumes the result. Successful and handled failure objects are written to stdout; always check the process exit status before interpreting a success payload. See [output fields and exit codes](/cli/output).

## Save an inventory

```sh
dockline list --path . --config server.yml --json > inventory.json
```

On success, `inventory.json` contains the list result with `ok: true`, `entries` and `complete: true`. Redirection also saves a JSON failure object if the operation fails, so file creation alone does not indicate success.

## Check the exit status

::: code-group

```sh [POSIX shell]
if dockline list --path . --config server.yml --json > inventory.json; then
    printf 'Inventory complete\n'
else
    printf 'Inventory failed\n' >&2
    exit 1
fi
```

```powershell [PowerShell]
dockline list --path . --config server.yml --json > inventory.json

if ($LASTEXITCODE -ne 0) {
    throw 'Inventory failed'
}

Write-Output 'Inventory complete'
```

:::

Successful wrapper output: `Inventory complete`. The saved JSON remains colour-free. For unattended SFTP provide a previously approved managed host record or independently verified fingerprint; piped/JSON runs cannot approve unknown hosts interactively. Supply secrets through the configured environment/provider mechanism, not command arguments.
