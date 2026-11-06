# Run the API examples

Run these from an installed source checkout after `npm run build`. They use temporary local fixtures, never saved application settings or an external server.

| Task | Command | What it checks |
| --- | --- | --- |
| File operations over FTP | `node examples/test-api.mjs ftp` | Upload, stat, exact-byte download, rename, delete, directory, streams and listing |
| The same operations over SFTP | `node examples/test-api.mjs sftp` | The same public methods with a generated host-key pin |
| SSH execution | `node examples/test-ssh.mjs` | Authentication, stdout, stderr and exit status |
| Encrypted key conversion | `node examples/test-keys.mjs` | PPK/OpenSSH identity preservation and wrong-passphrase refusal |

The FTP and SFTP API examples print the [quick-start transcript](/api/quick-start#output). The SSH and key examples have [captured output and fixture boundaries](/guide/local-demo#ssh). The SSH fixture recognizes controlled commands; it does not implement a full operating system or sudo.

For executable transfer commands rather than JavaScript calls, use the [CLI local-server walkthrough](/cli/quick-start).
