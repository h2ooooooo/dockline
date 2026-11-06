# Keys documentation

**Inspect and convert SSH keys independently of a transfer client.** Dockline Keys reads PuTTY PPK v2/v3, OpenSSH and supported PEM formats, extracts public keys and creates encrypted exports. Use it on its own for key operations, without opening a server connection.

```sh
npm install @jalsoedesign/dockline-keys
```

## Get a first result

Install the package above, then follow [the quick start](/keys/quick-start). It inspects a public sample key in memory, needs no files or credentials, and includes a complete program and exact output in all four languages.

## Common tasks

| Your task | Start here |
| --- | --- |
| Try the library without a key file | [Quick start](/keys/quick-start) |
| Inspect format, algorithm, encryption and fingerprint | [Inspect a key](/keys/inspect) |
| Convert PPK ↔ OpenSSH or supported PEM formats | [Convert private keys](/keys/convert) |
| Read encrypted input or change a passphrase | [Encryption and passphrases](/keys/encryption) |
| Extract a public key or convert its representation | [Public keys](/keys/public-keys) |
| Load and save files | [File recipes](/keys/files) |

## Advanced usage and reference

Read [encryption and passphrases](/keys/encryption) before choosing an export policy, and [file recipes](/keys/files) when adding storage. [Formats and algorithms](/keys/formats) list supported combinations; [API, errors and limits](/keys/reference) describes options, typed failures and resource bounds.

## Independent library, shared ecosystem

Only install `@jalsoedesign/dockline-keys`. Its dependencies include shared `dockline-abstract` error infrastructure and parsing/crypto libraries; it does not require core, SSH, SFTP, the CLI or FileZilla. It is a Node.js library, not a browser key editor or an executable.

Operations accept key **contents** as a string or Buffer, not a filename. Inspection returns metadata; conversions return Buffers. Supply storage, prompts and secret handling as needed. The [quick start](/keys/quick-start) needs no filesystem code.

Dockline SSH/SFTP also use this reader internally. For transfers, return to the [API area](/api/); key-only users can stay entirely in this section.
