# Run a local demo

These repository fixture commands run assertions against disposable servers. Their existing `.mjs` filenames belong to the development tools, not the copy-and-save API examples; use [the API quick start](/api/quick-start) for all four programming-language variants. Run the commands from this repository’s root after installing its dependencies. Build the packages once:

```sh
npm run build
```

FTP/SFTP examples start actual protocol servers bound to 127.0.0.1 on automatically selected temporary ports. They use public test credentials, generated SSH host keys and temporary storage. The SFTP fixture is reused from the integration tests. No Docker, system service, application installation or real account is needed. Each example stops its server and removes its temporary files on success or failure. No existing application settings are read or changed.

## FTP

Run:

```sh
node examples/test-ftp.mjs
```

Equivalent npm command: `npm run demo:ftp`.

This invokes the actual `dockline upload`, `list`, `download` and `remove` commands. It verifies downloaded bytes and confirms that the uploaded remote file was removed. Only the temporary server is modified.

Expected output, captured from a successful run:

```text
FTP server started on 127.0.0.1 (temporary port).
$ dockline upload --source-file input.txt --destination-file hello.txt --config <temporary-config> --json
{"ok":true,"command":"upload","sourceFile":"<temporary-directory>\\input.txt","destinationFile":"hello.txt","bytesTransferred":21}
$ dockline list --path . --config <temporary-config> --json
{"ok":true,"command":"list","path":".","entries":[{"path":"./hello.txt","type":"file","size":21}],"complete":true}
$ dockline download --source-file hello.txt --destination-file output.txt --config <temporary-config> --json
{"ok":true,"command":"download","sourceFile":"hello.txt","destinationFile":"<temporary-directory>\\output.txt","bytesTransferred":21}
$ dockline remove --path hello.txt --config <temporary-config> --json
{"ok":true,"command":"remove","path":"hello.txt","removed":1}
PASS: upload, list, exact-byte download and removal over FTP.
Local server stopped.
Temporary files removed.
```

## SFTP

Run:

```sh
node examples/test-sftp.mjs
```

Equivalent npm command: `npm run demo:sftp`.

This invokes the actual `dockline upload`, `list`, `download` and `remove` commands. It verifies downloaded bytes and confirms that the uploaded remote file was removed. A wrong-pin check must fail before password authentication. The reused SFTP fixture also exposes a sample symlink, shown in its listing. Only the temporary server is modified.

Expected output, captured from a successful run:

```text
SFTP server started on 127.0.0.1 (temporary port).
$ dockline upload --source-file input.txt --destination-file hello.txt --config <temporary-config> --json
{"ok":true,"command":"upload","sourceFile":"<temporary-directory>\\input.txt","destinationFile":"hello.txt","bytesTransferred":21}
$ dockline list --path . --config <temporary-config> --json
{"ok":true,"command":"list","path":".","entries":[{"path":"./hello.txt","type":"file","size":21,"lastModifiedMs":1700000000000},{"path":"./link","type":"file","size":0,"lastModifiedMs":1700000000000,"isSymbolicLink":true,"isUnsupported":true}],"complete":true}
$ dockline download --source-file hello.txt --destination-file output.txt --config <temporary-config> --json
{"ok":true,"command":"download","sourceFile":"hello.txt","destinationFile":"<temporary-directory>\\output.txt","bytesTransferred":21}
$ dockline remove --path hello.txt --config <temporary-config> --json
{"ok":true,"command":"remove","path":"hello.txt","removed":1}
Wrong host-key pin rejected before password authentication (exit 1).
PASS: upload, list, exact-byte download and removal over SFTP.
Local server stopped.
Temporary files removed.
```

## SSH

Run:

```sh
node examples/test-ssh.mjs
```

Equivalent npm command: `npm run demo:ssh`.

This uses the SSH SDK; the Dockline executable exposes transfer commands. The local SSH protocol fixture recognizes `whoami` and returns a controlled failure for other commands. It never executes received text in an operating-system shell. This checks authentication, pinned host identity, stdout, stderr and exit statuses; it is not a complete remote operating system or sudo implementation.

Expected output, captured from a successful run:

```text
SSH server started on 127.0.0.1 (temporary port).
$ session.exec('whoami')
{"code":0,"stdout":"fixture\n","stderr":""}
$ session.exec('unsupported', [], {allowFailure: true})
{"code":127,"stdout":"","stderr":"Demo command not supported\n"}
PASS: pinned SSH authentication, stdout, stderr and exit codes.
Local server stopped.
```

## Encrypted key conversion

Run:

```sh
node examples/test-keys.mjs
```

Equivalent npm command: `npm run demo:keys`.

This generates a disposable Ed25519 key in memory, converts it to encrypted PPK and back to encrypted OpenSSH, checks that its identity is preserved, and verifies wrong-passphrase rejection. No private key material is printed or written.

Expected output, captured from a successful run:

```text
Generated a disposable Ed25519 key in memory.
PKCS#8 -> encrypted PPK v3: identity verified.
Encrypted PPK -> encrypted OpenSSH: identity verified.
Wrong passphrase rejected.
PASS: bidirectional conversion and encrypted exports. No key files written.
```

## Interpreting the result

Each command exits 0 only after its assertions pass. A CLI failure, incorrect response, changed bytes or unexpected trust behavior produces a nonzero exit and an assertion error. Server ports, temporary paths, platform metadata and any file timestamps can vary. The wrapper displays temporary paths as `<temporary-directory>`; the child CLI receives actual paths. Run a single example at a time when comparing its transcript.

These examples require the development dependencies in this checkout, including the local protocol fixtures where applicable. They are not additional published CLI commands. For complete CLI inputs, output contracts and colored terminal examples, use the CLI reference.
