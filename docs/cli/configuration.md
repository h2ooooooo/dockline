# CLI configuration

The CLI reads `dockline.server.yml` from your working directory unless `--config` selects another file. YAML holds connection details and advanced transfer settings; flags select the everyday file operation.

## Basic structure

```yaml
version: 1
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    password: ${SFTP_PASSWORD}
    root: /home/ftp
    trust:
        fingerprint: ${SFTP_SHA256}
defaults:
    recursive: false
commands:
    download:
        sourceFile: reports/latest.csv
        destinationFile: downloads/latest.csv
        overwrite: fail
    upload:
        sourceFile: release.zip
        destinationFile: releases/release.zip
        overwrite: replace
    list:
        path: reports
    remove:
        path: obsolete.txt
```

`version` is optional and currently accepts `1`. The loader accepts one UTF-8 YAML document from a regular file up to 1 MiB. That limit is for configuration, not transferred files. Unknown keys, duplicate keys, aliases/anchors, custom tags, sequences, null values, multiple documents and prototype-related fields are rejected. `connection` is the shared connection configuration. `defaults` supplies common command choices; `commands` contains per-command overrides for `download`, `upload`, `list` and `remove`.

Transfer command sections accept `sourceFile`, `destinationFile`, `overwrite` and shared operation options. List/remove sections accept `path`, `recursive`, `maxDepth`, `maxEntries` and shared operation options. `defaults` can supply those command settings before selection.

An entry under `commands.remove` does not run a deletion by itself. It supplies values only when you invoke `dockline remove`.

## Environment variables

String values can include `${NAME}`. Variables are expanded after YAML parsing, and a missing referenced variable rejects the configuration. Expansion does not execute a shell or reparse the substituted value as YAML.

```yaml
connection:
    protocol: ftps
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
```

Supply credentials through your environment, a configured private key or a selected SSH agent. The CLI does not offer a password flag or automatically prompt for credentials. Missing or rejected authentication material becomes a normal connection error.

## Precedence

For operation options, more specific values win:

1. Command-line flags.
2. The current `commands.<name>` section.
3. `defaults`.
4. Connection-level operation settings.
5. The command/SDK defaults.

Only supported file-operation choices have flags. Put retry, timeout, size-limit, bandwidth and transport settings in YAML.

```yaml
connection:
    protocol: ftp
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
    timeoutMs: 30000
defaults:
    timeoutMs: 60000
commands:
    download:
        timeoutMs: 120000
        sourceFile: archive.zip
        destinationFile: downloads/archive.zip
```

`dockline download` uses the 120-second setting; another command uses 60 seconds unless it supplies its own value. Upload defaults to replacing the remote destination. Download defaults to refusing replacement. An `overwrite` value in defaults or the command section changes that choice, and a flag takes priority.

## Connection settings

| Setting | Meaning |
| --- | --- |
| `protocol` | `ftp`, `ftps`, `ftps-implicit` or `sftp`. Install the matching client explicitly. |
| `host`, `username` | Server identity and account. |
| `port` | Defaults to 21 for FTP/explicit FTPS, 990 for implicit FTPS, or 22 for SFTP. |
| `root` | Remote starting directory for relative command paths. |
| `password` | Static password or an environment-expanded value. |
| `privateKey`, `privateKeyPath`, `passphrase` | SFTP key authentication. |
| `agent` | Explicit SSH agent socket/pipe selection; no automatic discovery. |
| `readyTimeout` | Additional SSH handshake timeout. |
| `keyboardInteractive` | One string answer for a single-prompt SSH challenge; callback handlers require the SDK. |
| `agentForward` | Only `false` is supported. |
| `trust` | CLI SFTP trust policy described below. |
| `secureOptions` | FTPS TLS settings, including `caFile` for a private CA. |
| `passive`, `filenameEncoding`, `keepalive` | Supported protocol-specific settings. |

FTP `secureOptions` accepts `servername`, `rejectUnauthorized`, `caFile` and `minVersion` (`TLSv1.2` or `TLSv1.3`). Keep certificate verification enabled. `filenameEncoding` uses `charset` and optional `onUnrepresentable: reject`; SFTP accepts UTF-8 only. `keepalive` uses `intervalMs` and optional `maxMissed`. FTP `passive` is a boolean; active mode is unsupported.

See [FTP options](/guide/ftp) and [SSH options](/guide/sftp) for transport behavior. YAML represents data rather than application callbacks; JavaScript credential providers, UI handlers and observers belong in the [SDK integration](/guide/cli-integration).

## Transfer options

Connection settings can provide operation defaults, and `defaults` or a command section can override applicable values. Supported shared serializable settings are `autoReconnect`, `maxTransientRetries`, `timeoutMs`, `maxBytes` and a positive integer `bandwidth`. Connection configuration also accepts `timeout` as the SDK deadline alias:

| Setting | Default / meaning |
| --- | --- |
| `timeoutMs` | 30000 ms per attempt; `0` disables the deadline. |
| `autoReconnect` | `false`; permit eligible reconnection when enabled. |
| `maxTransientRetries` | Three additional eligible attempts after the first. |
| `maxBytes` | Unlimited by default; a finite non-negative safe integer imposes a per-transfer byte limit. |
| `bandwidth` | Optional bytes-per-second limit. |
| `overwrite` | `replace` for upload, `fail` for download; set under defaults or the command. |
| `recursive` | Recursive list/removal selection; set under defaults or the command. |
| `maxDepth`, `maxEntries` | List/remove traversal budgets; default `32` levels and `100000` examined entries. Set under defaults or the command section. |

Authentication, trust, permission and unsupported-operation failures are not automatic retry candidates. Partially consumed reads and uncertain mutations are not blindly repeated. An upload can restart from its local source only under the SDK's permitted retry rules; keep that source unchanged until the command finishes.

To remove an inherited byte limit, use `maxBytes: unlimited` or YAML `.inf`. Zero permits only empty content. A byte limit is separate from the deadline; deliberate bandwidth throttling still counts against elapsed time.

## SFTP trust and credentials

With no `connection.trust` setting, the CLI uses `~/.dockline/known-hosts.json`. It can ask about an unknown host only in an interactive terminal, including quiet mode. JSON mode and piped/noninteractive runs do not prompt. Approval records that exact server identity for later connections. A noninteractive run rejects an unknown key, and a changed key is rejected rather than silently replacing the remembered record.

For automation, pin an independently verified fingerprint:

```yaml
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    privateKeyPath: keys/deploy-key
    passphrase: ${SFTP_KEY_PASSPHRASE}
    trust:
        fingerprint: ${SFTP_SHA256}
```

The fingerprint is an OpenSSH `SHA256:…` value obtained through a trusted source. It is the server's public identity, not your private authentication key. A pin rejects a mismatching server.

To use another managed trust store:

```yaml
connection:
    protocol: sftp
    host: ${SFTP_HOST}
    username: ${SFTP_USERNAME}
    password: ${SFTP_PASSWORD}
    trust:
        knownHostsFile: state/known-hosts.json
```

Choose either `fingerprint` or `knownHostsFile`, not both. The custom file is relative to the configuration file. It uses Dockline's managed JSON format, not OpenSSH's `known_hosts` text format. See [managed host trust](/guide/trust) for persistence and conflict behavior.

## FTPS certificates

```yaml
connection:
    protocol: ftps
    host: ${FTP_HOST}
    username: ${FTP_USERNAME}
    password: ${FTP_PASSWORD}
    secureOptions:
        caFile: certificates/company-ca.pem
```

`caFile` is resolved relative to the configuration file and loaded as the trusted CA material. Certificate verification stays enabled. Explicit FTPS uses port 21 by default; implicit FTPS selects `protocol: ftps-implicit` and defaults to port 990.

## File locations

| Value | Relative to |
| --- | --- |
| `--config` | Working directory. |
| Local upload/download path supplied as a flag | Working directory. |
| Local upload/download path from YAML | Configuration file's directory. |
| `privateKeyPath`, TLS `caFile`, custom `knownHostsFile` | Configuration file's directory. |
| Relative remote `sourceFile`, `destinationFile` or `path` | `connection.root`. |
| Remote path starting with `/` | The server's absolute root for that command. |

For example, if a YAML file at `configs/production.yml` sets `commands.download.destinationFile: downloads/report.csv`, that resolves to `configs/downloads/report.csv`. Passing `--destination-file downloads/report.csv` instead resolves from the directory where you run the command.

Core's SDK continues to require relative remote operation paths. The CLI translates an absolute remote selection to a root of `/` for that command. Remote paths use forward slashes; removal rejects root, dot, parent-traversal and symlink/special targets.
