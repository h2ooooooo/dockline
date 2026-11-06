# Quick start SFTP

Connect over SSH, upload a local file, and download it again with the same Dockline session. This example uses a password and an independently verified server fingerprint.

For terminal commands instead of application code, use the optional [Dockline CLI](/guide/cli).

## Connect and transfer a file

Install [core and the SFTP client](/guide/installation#sftp), put a file named `hello.txt` in your working directory, and supply `SFTP_HOST`, `SFTP_USERNAME`, `SFTP_PASSWORD` and `SFTP_SHA256` through your environment. Obtain the server's OpenSSH `SHA256:…` fingerprint from your administrator or another trusted source. Use a writable starting directory, or set `SFTP_ROOT` to a writable remote folder that already exists.

Save `transfer-sftp.ts` by default, or the filename shown in the selected tab. Download: <a href="/examples/transfer-sftp.ts" download="transfer-sftp.ts">TypeScript</a> · <a href="/examples/transfer-sftp.js" download="transfer-sftp.js">JavaScript</a> · <a href="/examples/transfer-sftp.mjs" download="transfer-sftp.mjs">MJS</a> · <a href="/examples/transfer-sftp.cjs" download="transfer-sftp.cjs">CommonJS</a>

::: code-group

```ts [TypeScript]
// transfer-sftp.ts
import {Dockline, type SftpTransferConfig} from '@jalsoedesign/dockline-core';

function requiredEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} before running this example`);
    }

    return value;
}

const host = requiredEnv('SFTP_HOST');
const fingerprint = requiredEnv('SFTP_SHA256');
const port = 22;
const connection: SftpTransferConfig = {
    protocol: 'sftp',
    host,
    port,
    username: requiredEnv('SFTP_USERNAME'),
    password: requiredEnv('SFTP_PASSWORD'),
    root: process.env.SFTP_ROOT ?? '',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === host &&
        challenge.port === port &&
        challenge.fingerprint === fingerprint
    ),
    acceptTrustPolicy: () => false,
};

const remote = await Dockline.connect(connection);

try {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });

    console.log('Uploaded hello.txt and downloaded a copy into the working directory.');
} finally {
    await remote.disconnect();
}
```

```js [JavaScript]
// transfer-sftp.js
import {Dockline} from '@jalsoedesign/dockline-core';

function requiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} before running this example`);
    }

    return value;
}

const host = requiredEnv('SFTP_HOST');
const fingerprint = requiredEnv('SFTP_SHA256');
const port = 22;
const connection                     = {
    protocol: 'sftp',
    host,
    port,
    username: requiredEnv('SFTP_USERNAME'),
    password: requiredEnv('SFTP_PASSWORD'),
    root: process.env.SFTP_ROOT ?? '',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === host &&
        challenge.port === port &&
        challenge.fingerprint === fingerprint
    ),
    acceptTrustPolicy: () => false,
};

const remote = await Dockline.connect(connection);

try {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });

    console.log('Uploaded hello.txt and downloaded a copy into the working directory.');
} finally {
    await remote.disconnect();
}
```

```js [MJS]
// transfer-sftp.mjs
import {Dockline} from '@jalsoedesign/dockline-core';

function requiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} before running this example`);
    }

    return value;
}

const host = requiredEnv('SFTP_HOST');
const fingerprint = requiredEnv('SFTP_SHA256');
const port = 22;
const connection                     = {
    protocol: 'sftp',
    host,
    port,
    username: requiredEnv('SFTP_USERNAME'),
    password: requiredEnv('SFTP_PASSWORD'),
    root: process.env.SFTP_ROOT ?? '',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === host &&
        challenge.port === port &&
        challenge.fingerprint === fingerprint
    ),
    acceptTrustPolicy: () => false,
};

const remote = await Dockline.connect(connection);

try {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });

    console.log('Uploaded hello.txt and downloaded a copy into the working directory.');
} finally {
    await remote.disconnect();
}
```

```js [CommonJS]
// transfer-sftp.cjs
const {Dockline} = require('@jalsoedesign/dockline-core');

async function main() {
    function requiredEnv(name) {
        const value = process.env[name];

        if (!value) {
            throw new Error(`Set ${name} before running this example`);
        }

        return value;
    }

    const host = requiredEnv('SFTP_HOST');
    const fingerprint = requiredEnv('SFTP_SHA256');
    const port = 22;
    const connection                     = {
        protocol: 'sftp',
        host,
        port,
        username: requiredEnv('SFTP_USERNAME'),
        password: requiredEnv('SFTP_PASSWORD'),
        root: process.env.SFTP_ROOT ?? '',
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => (
            challenge.host === host &&
            challenge.port === port &&
            challenge.fingerprint === fingerprint
        ),
        acceptTrustPolicy: () => false,
    };

    const remote = await Dockline.connect(connection);

    try {
        // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
        await remote.uploadFile('./hello.txt', 'dockline-example.txt');

        // Download 'dockline-example.txt' from the server
        // to './dockline-downloaded.txt' on the host.
        await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
            overwrite: 'replace',
        });

        console.log('Uploaded hello.txt and downloaded a copy into the working directory.');
    } finally {
        await remote.disconnect();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

Set the variables using the [PowerShell or macOS/Linux commands](/api/quick-start#set-your-connection-details), including the independently verified fingerprint.

### Run the transfer

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx transfer-sftp.ts
```

```sh [JavaScript]
npm pkg set type=module
node transfer-sftp.js
```

```sh [MJS]
node transfer-sftp.mjs
```

```sh [CommonJS]
node transfer-sftp.cjs
```

:::

Successful output:

```text
Uploaded hello.txt and downloaded a copy into the working directory.
```

The uploaded source is `./hello.txt` on the host; the server destination is `dockline-example.txt`. The download reads that server file and writes host destination `./dockline-downloaded.txt`.

`Dockline.connect()` waits for host verification and authentication. Both trust hooks are required when `requireTrustPolicy` is true. This configuration accepts only the verified host, port and fingerprint; it rejects unfamiliar or changed keys. For a CLI or UI that asks and remembers approvals, see [host trust](/guide/trust).

Port 22 is the default. If your server uses another port, change the `port` constant; the connection and trust check both use it. For private keys, an SSH agent or interactive login, see [SFTP authentication](/guide/sftp#pick-an-authentication-method).

The `finally` block closes the connection even if a transfer fails. This example replaces the remote `dockline-example.txt` and explicitly allows replacing its local downloaded copy, so it can be run again.

Remote paths are relative to `root` and always use `/`. With an empty `root`, relative paths use the server's starting directory. Local paths are relative to your process's working directory.

## Fetch a remote file to the host

The following recipes replace the operations inside the complete program's connected `try` block. Keep its imports, connection setup and `finally` cleanup; save and rerun the same file with the commands above. Import statements shown in a recipe belong at the top of that file.

The recipes below belong inside the connected `try` block above. Use filenames you have created or selected.

::: code-group

```ts [TypeScript]
// Download 'dockline-example.txt' from the server
// to './another-copy.txt' on the host.
await remote.downloadFile('dockline-example.txt', './another-copy.txt');
```

```js [JavaScript]
// Download 'dockline-example.txt' from the server
// to './another-copy.txt' on the host.
await remote.downloadFile('dockline-example.txt', './another-copy.txt');
```

```js [MJS]
// Download 'dockline-example.txt' from the server
// to './another-copy.txt' on the host.
await remote.downloadFile('dockline-example.txt', './another-copy.txt');
```

```js [CommonJS]
// Download 'dockline-example.txt' from the server
// to './another-copy.txt' on the host.
await remote.downloadFile('dockline-example.txt', './another-copy.txt');
```

:::

The arguments are **remote source first, local destination second**. The local parent directory must exist. Downloads refuse to replace an existing local file by default; pass `{overwrite: 'replace'}` when replacement is intended. A download is staged locally and published after it completes. Downloads have no size limit by default. Set `maxBytes` on the connection or this call when you want a limit; see [download options](/guide/usage#downloads).

## Save a local file on the server

::: code-group

```ts [TypeScript]
// Upload local file './hello.txt' to 'dockline-another-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-another-upload.txt');
```

```js [JavaScript]
// Upload local file './hello.txt' to 'dockline-another-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-another-upload.txt');
```

```js [MJS]
// Upload local file './hello.txt' to 'dockline-another-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-another-upload.txt');
```

```js [CommonJS]
// Upload local file './hello.txt' to 'dockline-another-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-another-upload.txt');
```

:::

The arguments are **local source first, remote destination second**. The remote parent directory must exist. Uploads replace the remote file by default, and an interrupted ordinary upload can leave partial remote content.

To refuse replacement, use a new remote name and select SFTP's staged no-replace upload:

::: code-group

```ts [TypeScript]
// Upload local file './hello.txt' to 'dockline-new-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-new-upload.txt', {
    overwrite: 'fail',
});
```

```js [JavaScript]
// Upload local file './hello.txt' to 'dockline-new-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-new-upload.txt', {
    overwrite: 'fail',
});
```

```js [MJS]
// Upload local file './hello.txt' to 'dockline-new-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-new-upload.txt', {
    overwrite: 'fail',
});
```

```js [CommonJS]
// Upload local file './hello.txt' to 'dockline-new-upload.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-new-upload.txt', {
    overwrite: 'fail',
});
```

:::

This fails if that remote name already exists. For verification and atomic replacement options, see [staged publication](/guide/advanced-transfers).

## List files and directories

::: code-group

```ts [TypeScript]
for await (const entry of remote.list('.')) {
    console.log(entry.path, entry.type);
}
```

```js [JavaScript]
for await (const entry of remote.list('.')) {
    console.log(entry.path, entry.type);
}
```

```js [MJS]
for await (const entry of remote.list('.')) {
    console.log(entry.path, entry.type);
}
```

```js [CommonJS]
for await (const entry of remote.list('.')) {
    console.log(entry.path, entry.type);
}
```

:::

`.` selects the configured root. Listing is shallow by default; use `remote.list('.', {deep: true})` for recursive listing, or [bounded traversal](/guide/advanced-transfers) when you need limits and a completion result.

## Check a file's details

::: code-group

```ts [TypeScript]
const details = await remote.stat('dockline-example.txt');

if (details.type === 'file') {
    console.log(details.path, details.size);
}
```

```js [JavaScript]
const details = await remote.stat('dockline-example.txt');

if (details.type === 'file') {
    console.log(details.path, details.size);
}
```

```js [MJS]
const details = await remote.stat('dockline-example.txt');

if (details.type === 'file') {
    console.log(details.path, details.size);
}
```

```js [CommonJS]
const details = await remote.stat('dockline-example.txt');

if (details.type === 'file') {
    console.log(details.path, details.size);
}
```

:::

`stat()` returns the entry's type and available metadata. Missing files, inaccessible paths and connection failures are errors; handle them through the [error API](/guide/errors).

## Create a remote directory

::: code-group

```ts [TypeScript]
await remote.createDirectory('dockline-example');
// Upload local file './hello.txt' to 'dockline-example/hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-example/hello.txt');
```

```js [JavaScript]
await remote.createDirectory('dockline-example');
// Upload local file './hello.txt' to 'dockline-example/hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-example/hello.txt');
```

```js [MJS]
await remote.createDirectory('dockline-example');
// Upload local file './hello.txt' to 'dockline-example/hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-example/hello.txt');
```

```js [CommonJS]
await remote.createDirectory('dockline-example');
// Upload local file './hello.txt' to 'dockline-example/hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-example/hello.txt');
```

:::

`createDirectory()` creates missing parent directories too. It does not change the configured root.

## Write and read text

::: code-group

```ts [TypeScript]
await remote.write('dockline-notes.txt', 'Hello from Dockline\n');

const stream = await remote.read('dockline-notes.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [JavaScript]
await remote.write('dockline-notes.txt', 'Hello from Dockline\n');

const stream = await remote.read('dockline-notes.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [MJS]
await remote.write('dockline-notes.txt', 'Hello from Dockline\n');

const stream = await remote.read('dockline-notes.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [CommonJS]
await remote.write('dockline-notes.txt', 'Hello from Dockline\n');

const stream = await remote.read('dockline-notes.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

:::

`write()` accepts a string, Buffer or stream. `read()` returns a Node readable stream, so consume it fully before disconnecting. Use `uploadFile()` and `downloadFile()` when both ends of your operation are filenames.

## Rename a remote file

After creating `dockline-notes.txt` in the previous recipe:

::: code-group

```ts [TypeScript]
// Rename server source 'dockline-notes.txt' to server destination 'dockline-notes-renamed.txt'.
await remote.rename('dockline-notes.txt', 'dockline-notes-renamed.txt', {
    overwrite: 'fail',
});
```

```js [JavaScript]
// Rename server source 'dockline-notes.txt' to server destination 'dockline-notes-renamed.txt'.
await remote.rename('dockline-notes.txt', 'dockline-notes-renamed.txt', {
    overwrite: 'fail',
});
```

```js [MJS]
// Rename server source 'dockline-notes.txt' to server destination 'dockline-notes-renamed.txt'.
await remote.rename('dockline-notes.txt', 'dockline-notes-renamed.txt', {
    overwrite: 'fail',
});
```

```js [CommonJS]
// Rename server source 'dockline-notes.txt' to server destination 'dockline-notes-renamed.txt'.
await remote.rename('dockline-notes.txt', 'dockline-notes-renamed.txt', {
    overwrite: 'fail',
});
```

:::

This refuses to replace an existing destination. SFTP replacement with `{overwrite: 'replace'}` requires the server's `posix-rename@openssh.com` extension. Atomic no-replace rename is unsupported; see [SFTP capabilities](/guide/sftp#filenames-transfer-progress-and-server-capabilities) before depending on optional server features.

## Delete a remote file

To remove the example file after renaming it:

::: code-group

```ts [TypeScript]
await remote.deleteFile('dockline-notes-renamed.txt');
```

```js [JavaScript]
await remote.deleteFile('dockline-notes-renamed.txt');
```

```js [MJS]
await remote.deleteFile('dockline-notes-renamed.txt');
```

```js [CommonJS]
await remote.deleteFile('dockline-notes-renamed.txt');
```

:::

This removes that remote file. `deleteFile()` does not remove directories; advanced directory operations are available through the [underlying connector](/guide/usage#advanced-access).

## Let Dockline close the session

For a short job, replace the explicit connection and `try`/`finally` with `withConnection()`:

::: code-group

```ts [TypeScript]
await Dockline.withConnection(connection, async remote => {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });
});
```

```js [JavaScript]
await Dockline.withConnection(connection, async remote => {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });
});
```

```js [MJS]
await Dockline.withConnection(connection, async remote => {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });
});
```

```js [CommonJS]
await Dockline.withConnection(connection, async remote => {
    // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    // Download 'dockline-example.txt' from the server
    // to './dockline-downloaded.txt' on the host.
    await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
        overwrite: 'replace',
    });
});
```

:::

The callback has the same connected API and trust configuration. Dockline disconnects after it finishes, including failure paths. Finish consuming streams and iterators inside the callback.

Continue with [SFTP authentication and SSH options](/guide/sftp), [remembered host decisions](/guide/trust), [shared configuration and retries](/guide/configuration), or the [FTP quick start](/ftp/quick-start).
