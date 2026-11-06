# CLI documentation

Upload, download, list and remove files over FTP, FTPS or SFTP from a terminal. Save connection settings in YAML and select the operation with a command. The CLI is optional; the [API](/api/) works without it.

## Get a first result

Start with the [CLI quick start](/cli/quick-start): install the CLI and a protocol client, create a connection file, list the server, then transfer one small file. No source checkout is required. Without a server account, use the [local CLI demos](/guide/local-demo).

## Choose a command

| Task | Guide | Direction |
| --- | --- | --- |
| Send a file | [upload](/cli/upload) | Host source → server destination |
| Save a file | [download](/cli/download) | Server source → host destination |
| Inspect a directory | [list](/cli/list) | Read entries on the server |
| Remove a selected file or tree | [remove](/cli/remove) | Delete the selected server path |

Each guide shows the command, example output, overwrite defaults and failure behavior. Terminal commands are shared across JavaScript/TypeScript projects, so they use shell tabs where syntax differs rather than programming-language tabs.

## Configure and automate

Use [configuration](/cli/configuration) for credentials, verified host trust, roots and YAML defaults. Use [output and exit codes](/cli/output) and [shell scripting](/cli/scripting) for automation. If a command fails, start with [troubleshooting](/cli/troubleshooting).

## Reference and boundaries

Look up [every flag](/cli/help) or [command behavior](/cli/commands). To call the command runner from Node.js, see [embedding](/guide/cli-integration#embed-the-packaged-cli).

The CLI has file-transfer commands. SSH execution is documented in the [SSH API](/ssh/quick-start); key inspection and conversion are documented in [Keys](/keys/).
