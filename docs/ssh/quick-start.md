# Run your first SSH command

Execute one command and inspect the result. An SSH login needs command-execution permission; an SFTP-only account may not have it.

## Install

```sh
npm install @jalsoedesign/dockline-ssh-client
```

## Set your connection details

Use your real account and independently verified host fingerprint. These are the same variables as the SFTP quick start.

::: code-group

```powershell [PowerShell]
$env:SFTP_HOST = "files.example.com"
$env:SFTP_USERNAME = "deploy"
$env:SFTP_PASSWORD = "your-password"
$env:SFTP_SHA256 = "SHA256:your-verified-server-fingerprint"
```

```sh [macOS / Linux]
export SFTP_HOST="files.example.com"
export SFTP_USERNAME="deploy"
export SFTP_PASSWORD="your-password"
export SFTP_SHA256="SHA256:your-verified-server-fingerprint"
```

:::

## Save your SSH example

::: code-group

```ts [TypeScript]
// ssh.ts
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set the four connection variables first.');
}

const client = new SshClient({
    host: SFTP_HOST,
    port: 22,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    hostFingerprint: SFTP_SHA256,
});

await client.withConnection(async session => {
    const result = await session.exec('whoami');

    process.stdout.write(result.stdout);
    console.log('Exit code:', result.code);
});
```

```js [JavaScript]
// ssh.js
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set the four connection variables first.');
}

const client = new SshClient({
    host: SFTP_HOST,
    port: 22,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    hostFingerprint: SFTP_SHA256,
});

await client.withConnection(async session => {
    const result = await session.exec('whoami');

    process.stdout.write(result.stdout);
    console.log('Exit code:', result.code);
});
```

```js [MJS]
// ssh.mjs
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set the four connection variables first.');
}

const client = new SshClient({
    host: SFTP_HOST,
    port: 22,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    hostFingerprint: SFTP_SHA256,
});

await client.withConnection(async session => {
    const result = await session.exec('whoami');

    process.stdout.write(result.stdout);
    console.log('Exit code:', result.code);
});
```

```js [CommonJS]
// ssh.cjs
const {SshClient} = require('@jalsoedesign/dockline-ssh-client');

async function main() {
    const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

    if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
        throw new Error('Set the four connection variables first.');
    }

    const client = new SshClient({
        host: SFTP_HOST,
        port: 22,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        hostFingerprint: SFTP_SHA256,
    });

    await client.withConnection(async session => {
        const result = await session.exec('whoami');

        process.stdout.write(result.stdout);
        console.log('Exit code:', result.code);
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

## Run

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx ssh.ts
```

```sh [JavaScript]
npm pkg set type=module
node ssh.js
```

```sh [MJS]
node ssh.mjs
```

```sh [CommonJS]
node ssh.cjs
```

:::

Example output for an account named deploy:

```text
deploy
Exit code: 0
```

The username depends on your server. The SDK returns stdout/stderr/code; the example prints them explicitly. Nonzero command exits reject unless `allowFailure` is selected. This first example performs no service restart or file transfer.

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

## PuTTY PPK v2 and v3

`privateKeyPath` can point directly to a PuTTY `.ppk` **v2 or v3** file, either unencrypted or encrypted. For an encrypted key, supply `passphrase` directly or through a secret provider. SSH commands and the session's SFTP transfers share Dockline's in-memory key reader; the source key file is not changed. For key inspection, conversion and encrypted exports without a connection, use [Dockline Keys](/keys/). See [supported formats, error reasons and resource limits](/guide/sftp#putty-ppk-keys). Host fingerprints must still be verified independently.

## File-helper differences

`SshSession.download` stages a temporary local file and renames it over the destination on completion. Unlike the generic Dockline SDK download default, this SSH-specific helper has no overwrite policy option and can replace an existing destination. Use the generic SDK/adapters when explicit overwrite or publication policies are required. Each SSH file helper opens and closes its own SFTP connector; it does not reuse the exec channel as an SFTP channel.

## Local test without an SSH account

See the [controlled local SSH fixture](/guide/local-demo#ssh), which recognizes `whoami` without executing received text in an operating-system shell.
