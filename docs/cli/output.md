# CLI output reference

Dockline emits plain text for humans and structured JSON for scripts. `--json` takes precedence over `--quiet`. List data is retained in quiet mode. Progress/success text is excluded from the JSON stream.

## Safe configuration-error example

This output was captured without connecting to a server.

```sh
dockline list --config missing.yml --json
```

Exit code: 2. JSON errors go to stdout.

```json
{"ok":false,"command":"list","error":{"code":"DOCKLINE_CONFIG_ERROR","message":"Unable to read the configuration as a regular UTF-8 file"}}
```

## Transfer success

Representative output shapes below document successful remote operations; no remote host was contacted to produce them.

```text
Downloaded 128 bytes: reports/example.txt -> ./example.txt
Uploaded 128 bytes: ./example.txt -> uploads/example.txt
```

```json
{"ok":true,"command":"download","sourceFile":"reports/example.txt","destinationFile":"./example.txt","bytesTransferred":128}
```

`upload` has the same fields with `command: 'upload'`. Byte counts describe completed transfer consumption.

## Directory listing

Human output is tab-separated type, size (or `-`), and path, one entry per line. Types can be `file`, `directory`, `link` or `special`.

```text
file	128	example.txt
directory	-	reports
```

```json
{"ok":true,"command":"list","path":".","entries":[{"path":"example.txt","type":"file","size":128}],"complete":true}
```

Entries can also include `lastModifiedMs`, `isSymbolicLink` and `isUnsupported`. An incomplete traversal is an error, never a successful partial listing.

## Removal

```text
Removed 1 remote entry: uploads/example.txt
```

```json
{"ok":true,"command":"remove","path":"uploads/example.txt","removed":1}
```

Removal is a mutation. Recursive removal is explicit and is not rolled back after partial failure.

## Errors, streams and exit codes

JSON failures use `{ok:false, command?, error:{code,message}}` on stdout. `command` can be absent when parsing fails. Without `--json`, errors use stderr with a `dockline:` prefix. Secret text is redacted. `--quiet` suppresses transfer success text, not list data or failures.

| Exit | Meaning |
| --- | --- |
| 0 | Success, help or version |
| 1 | Connection, authentication, trust, transfer or operation failure |
| 2 | Invalid usage or configuration |
| 130 | Cancelled execution |

SFTP approval prompts are possible only in an interactive terminal; JSON/piped runs require a previously approved host or an independently verified fingerprint. Cancellation waits for operation cleanup. See [all command inputs](/cli/help), [configuration](/cli/configuration) and [command behavior](/cli/commands).
