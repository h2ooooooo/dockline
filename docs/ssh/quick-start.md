# SSH commands

`@jalsoedesign/dockline-ssh-client` provides scoped SSH command execution and SFTP transfers. It is independently installable; core, FTP and SFTP consumers do not need to install it.

```sh
npm install @jalsoedesign/dockline-ssh-client
```

This new workspace must be published before that registry command is available. Repository users can build it with `npm run build --workspace @jalsoedesign/dockline-ssh-client`.

```ts
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

const client = new SshClient({
    host: 'server.example.com',
    port: 22,
    username: 'deployer',
    privateKeyPath: '/home/me/.ssh/deployer',
    hostFingerprint: process.env.SSH_HOST_FINGERPRINT,
});

await client.withConnection(async server => {
    const result = await server.exec('uptime');

    console.log(result.stdout);

    await server.download({
        sourceFile: '/var/backups/export.sql',
        destinationFile: './backups/export.sql',
    });

    await server.exec('systemctl', ['restart', 'website'], {
        sudo: true,
        timeout: '1m',
    });
});
```

Without an explicit fingerprint or a supplied `trust(host, port, fingerprint)` callback, connections reject unknown hosts. The application owns trust persistence and any prompt UI. Supply optional `ask`, `log`, `signal` and `directory` callbacks/settings as the constructor's second argument. `ask` receives an input/password challenge and returns its answer. No CLI prompt implementation is bundled.

`withConnection` authenticates and closes its connection in `finally`. Passwords, private-key passphrases, explicit SSH agents and keyboard-interactive authentication are supported. Agent forwarding is not enabled. An SFTP account does not necessarily have command-execution permission.

## Command API

- `exec(program, args?, options?)` quotes each argument for a POSIX remote shell.
- `shell(command, options?)` explicitly executes `sh -c` for shell expressions.
- `asUser(username, callback)` runs scoped commands through `sudo -u`.
- `download({sourceFile, destinationFile, timeout?, maxBytes?})` uses a temporary local file before replacement.
- `upload({sourceFile, destinationFile, timeout?, maxBytes?})` streams a local file using Dockline SFTP.

Exec options include `timeout`, `sudo` (boolean or target username) and `allowFailure`. Results include `code`, `stdout` and `stderr`; returned output retains the last 1 MiB per stream while `log` receives streamed output. Nonzero exit codes reject by default. Timeouts accept positive milliseconds or strings such as `30s`, `5m` and `1h`; the default command/transfer deadline is one hour. Commands are never automatically retried.

The transfer helpers open separate SFTP connections with the same resolved credentials and host verifier. They have no default byte cap. A transfer does not inherit sudo privileges: files created by privileged commands must be readable by the SFTP user.

Sudo defaults to noninteractive mode. Set `sudo.password: 'prompt'` with an `ask` callback, or `sudo.passwordEnv`, when a password is required. Passwords travel through stdin when the sudo prompt appears, not command arguments. Servers requiring an interactive TTY are outside this API's initial scope.

Cancellation requests command termination and closes channels. The remote server may ignore a signal; inspect remote state before retrying. Remote Windows shell syntax and persistent interactive `sudo su` sessions are not supported.

See the [SSH package source](https://github.com/h2ooooooo/dockline/tree/main/packages/ssh-client).

## PuTTY PPK v3

`privateKeyPath` can point directly to a `.ppk` v3 file. For an encrypted key, supply `passphrase` through your application or secret provider. SSH commands and the session's SFTP transfers share Dockline's in-memory key reader; the source key file is not changed. See [supported formats, error reasons and resource limits](/guide/sftp#putty-ppk-keys). Host fingerprints must still be verified independently.
