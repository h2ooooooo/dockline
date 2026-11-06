# Complete CLI input reference

Captured from the actual dockline executable. The CLI currently exposes transfer commands; SSH execution and key conversion are separate SDK packages.

## dockline

```text
Usage: dockline [options] [command]

Transfer files over FTP, FTPS and SFTP using an installed Dockline client.

Options:
  -V, --version        output the version number
  -c, --config <file>  YAML server configuration (default:
                       "dockline.server.yml")
  --json               write one structured JSON result
  --quiet              suppress human success output; keep list data and errors
  -h, --help           display help for command

Commands:
  download [options]   Download one remote file to a local file
  upload [options]     Upload one local file to a remote file
  list [options]       List remote directory entries
  remove [options]     Remove a remote file or directory

Install @jalsoedesign/dockline-ftp-client for FTP/FTPS or @jalsoedesign/dockline-sftp-client for SFTP.
Advanced connection, retry, bandwidth and limit settings belong in the YAML config.
```

## download

```text
Usage: dockline download [options]

Download one remote file to a local file

Options:
  -s, --source-file <file>       remote source file
  -d, --destination-file <file>  local destination file
  --overwrite <policy>           existing destination policy (default: fail)
                                 (choices: "fail", "replace")
  -h, --help                     display help for command

Global Options:
  -V, --version                  output the version number
  -c, --config <file>            YAML server configuration (default:
                                 "dockline.server.yml")
  --json                         write one structured JSON result
  --quiet                        suppress human success output; keep list data
                                 and errors
```

## upload

```text
Usage: dockline upload [options]

Upload one local file to a remote file

Options:
  -s, --source-file <file>       local source file
  -d, --destination-file <file>  remote destination file
  --overwrite <policy>           existing destination policy (default: replace)
                                 (choices: "fail", "replace")
  -h, --help                     display help for command

Global Options:
  -V, --version                  output the version number
  -c, --config <file>            YAML server configuration (default:
                                 "dockline.server.yml")
  --json                         write one structured JSON result
  --quiet                        suppress human success output; keep list data
                                 and errors
```

## list

```text
Usage: dockline list [options]

List remote directory entries

Options:
  -p, --path <path>    remote directory (default:.)
  -r, --recursive      include nested directories
  --no-recursive       disable recursive mode from configuration
  -h, --help           display help for command

Global Options:
  -V, --version        output the version number
  -c, --config <file>  YAML server configuration (default:
                       "dockline.server.yml")
  --json               write one structured JSON result
  --quiet              suppress human success output; keep list data and errors
```

## remove

```text
Usage: dockline remove [options]

Remove a remote file or directory

Options:
  -p, --path <path>    remote file or directory
  -r, --recursive      include nested directories
  --no-recursive       disable recursive mode from configuration
  -h, --help           display help for command

Global Options:
  -V, --version        output the version number
  -c, --config <file>  YAML server configuration (default:
                       "dockline.server.yml")
  --json               write one structured JSON result
  --quiet              suppress human success output; keep list data and errors
```
