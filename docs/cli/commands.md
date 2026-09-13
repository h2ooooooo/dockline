# CLI commands

The `dockline` executable comes from `@dockline/cli`. Install a matching protocol client and prepare a [YAML connection](/cli/configuration) before transferring files. Help and version do not require either.

## Shared flags

| Flag | Meaning |
| --- | --- |
| `--config <file>`, `-c <file>` | YAML configuration; defaults to `dockline.server.yml` in the working directory. |
| `--json` | Structured success or failure output for scripts. |
| `--quiet` | Suppress routine human-readable success/progress output. |
| `--help`, `-h` | Show command help without loading configuration or clients. |
| `--version`, `-V` | Show the CLI package version. |

Authentication, host, port, retries, deadlines, trust, bandwidth and byte limits are configured in YAML. There is no password flag or automatic password prompt.

## Download

```sh
dockline download --source-file "/home/ftp/blabla.txt" --destination-file "blabla.txt" --config dockline.server.yml
```

| Flag | Meaning |
| --- | --- |
| `--source-file <path>`, `-s <path>` | Remote source file. |
| `--destination-file <path>`, `-d <path>` | Local destination file. |
| `--overwrite <policy>` | `fail` or `replace`; download defaults to `fail`. |

Source and destination can also come from YAML defaults or `commands.download`. Flags override the configured value. The CLI creates missing local parent directories, downloads into staging and publishes the local file after the transfer completes. A failed download does not replace the existing destination before publication.

To replace an existing local file deliberately:

```sh
dockline download -s "/home/ftp/blabla.txt" -d "./downloads/blabla.txt" --overwrite replace
```

File size is unlimited by default. Set `maxBytes` in [YAML](/cli/configuration#transfer-options) when the job needs a limit. Completion still includes the SDK's stream, advertised-length and cleanup checks; it is not a snapshot of a file changing on the server.

## Upload

```sh
dockline upload --source-file "./hello.txt" --destination-file "/home/ftp/hello.txt"
```

| Flag | Meaning |
| --- | --- |
| `--source-file <path>`, `-s <path>` | Local source file. |
| `--destination-file <path>`, `-d <path>` | Remote destination file. |
| `--overwrite <policy>` | `replace` or `fail`; upload defaults to `replace`. |

The source must be a regular local file, and the remote parent directory must exist. Ordinary replacement writes directly, so a failure can leave partial remote content.

For a new SFTP destination that must not replace an existing file:

```sh
dockline upload -s "./hello.txt" -d "/home/ftp/new-hello.txt" --overwrite fail
```

This selects staged no-replace publication. FTP and FTPS reject `overwrite: fail` before connecting because portable FTP cannot guarantee it. Do not use an existence check as a substitute for a supported no-replace operation.

## List

```sh
dockline list --path "/home/ftp"
dockline list --path "/home/ftp" --recursive
```

| Flag | Meaning |
| --- | --- |
| `--path <path>`, `-p <path>` | Remote directory to list. |
| `--recursive`, `-r` | Include descendants using bounded traversal. |
| `--no-recursive` | Disable recursion even when YAML enables it. |

Ordinary listing shows the selected directory's immediate entries. Recursive listing uses Dockline's walker and checks its completion result; a traversal that hits its configured limit is not reported as a complete inventory. Use JSON output when another tool needs structured entries and results.

## Remove

```sh
dockline remove --path "/home/ftp/hello.txt"
dockline remove --path "/home/ftp/old-release" --recursive
```

| Flag | Meaning |
| --- | --- |
| `--path <path>`, `-p <path>` | Remote file or directory to remove. |
| `--recursive`, `-r` | Permit removing a nonempty directory and its contents. |
| `--no-recursive` | Require a file or empty directory even when YAML enables recursion. |

The command removes a file or an empty directory by default. Nonempty directory removal requires explicit recursive selection, which may be set in the command's YAML configuration. There is no separate `--yes` confirmation flag.

Root, dot, parent-traversal and symlink/special-file targets are refused. Remote paths still depend on the server's filesystem behavior; a server-side concurrent change is not a local filesystem transaction. The command waits for operation and connection cleanup before returning.

Recursive listing and removal default to `maxDepth: 32` and `maxEntries: 100000`; override these budgets in YAML. An incomplete listing returns an error with exit code `1` rather than a complete result. Recursive removal completes its bounded inventory before deleting anything, so an incomplete inventory is rejected before mutation. A later deletion or connection failure can leave a partially removed tree; removal does not roll back completed deletions.

## Path resolution

| Path supplied by | Local meaning | Remote meaning |
| --- | --- | --- |
| CLI flag | Relative to the process working directory | Relative to `connection.root`, unless it starts with `/` |
| YAML command/default value | Relative to the configuration file's directory | Relative to `connection.root`, unless it starts with `/` |
| Absolute path | Normal local absolute path | A leading `/` selects an absolute remote path and overrides `root` for that command |

Remote paths use forward slashes. The CLI's absolute-remote support is an input translation; it does not change core's SDK contract requiring relative operation paths. Local source/destination direction depends on the command: upload reads locally, download writes locally.

## Output and exit codes

`--json` writes a structured success or failure result to standard output. Progress and ordinary human formatting are excluded from that stream. Without JSON, errors go to standard error. Quiet mode suppresses routine human success/progress output rather than hiding failures or list data. `--json` takes precedence over quiet mode and still emits its result. Quiet mode still allows an interactive host-approval prompt. JSON mode and piped/noninteractive runs do not prompt; an unknown host needs a verified pin or a previously approved managed record.

| JSON result | Fields |
| --- | --- |
| Upload/download success | `{ok: true, command, sourceFile, destinationFile, bytesTransferred}` |
| List success | `{ok: true, command, path, entries, complete: true}` |
| Remove success | `{ok: true, command, path, removed}`; `removed` is a count |
| Failure | `{ok: false, command?, error: {code, message}}` |

The command field can be absent when command selection itself fails. Do not infer completion from a partial entry stream or treat an error result as an empty remote directory.

| Exit code | Result |
| --- | --- |
| `0` | Success, help or version. |
| `1` | Transfer, connection or operation failure. |
| `2` | Usage or configuration failure. |
| `130` | Cancelled execution. |

The executable handles cancellation and waits for disconnect and cleanup before exiting. When [embedding the CLI](/guide/cli-integration#embed-the-packaged-cli), your application owns its signal handling and supplies cancellation through the context.
