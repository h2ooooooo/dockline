# Connect to your SFTP server

Install two packages and run one small example in TypeScript or JavaScript. This first example lists a remote directory and closes the connection; it does not change server files.

**You need:** a supported [Node.js runtime](/guide/installation), an SFTP account and the server's independently verified SSH fingerprint. You do not need a Dockline source checkout. Choose the language tab that matches your project.

Want to try it without a server? Use the [self-contained local demo](/api/local-demo) instead.

## Install

From a new directory:

```sh
npm init -y
npm install @jalsoedesign/dockline-core @jalsoedesign/dockline-sftp-client
```

## Set your connection details

Replace the example values and run these in the same terminal you will use for Node. Obtain the fingerprint from your administrator or another trusted channel. It is the server identity, separate from your login password or private key.

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

## Save your connection example

TypeScript is selected by default. Save the filename shown in your tab. [Module setup and file extensions](/guide/code-examples) explains the JavaScript alternatives once.

Download: <a href="/examples/connect.ts" download="connect.ts">TypeScript</a> · <a href="/examples/connect.js" download="connect.js">JavaScript</a> · <a href="/examples/connect.mjs" download="connect.mjs">MJS</a> · <a href="/examples/connect.cjs" download="connect.cjs">CommonJS</a>

::: code-group

```ts [TypeScript]
// connect.ts
import {Dockline, type SftpTransferConfig} from '@jalsoedesign/dockline-core';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD and SFTP_SHA256.');
}

const connection: SftpTransferConfig = {
    protocol: 'sftp',
    host: SFTP_HOST,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === SFTP_HOST &&
        challenge.port === 22 &&
        challenge.fingerprint === SFTP_SHA256
    ),
    acceptTrustPolicy: () => false,
};

await Dockline.withConnection(connection, async remote => {
    for await (const entry of remote.list('.')) {
        console.log(entry.path, entry.type);
    }

    console.log('Directory listed.');
});

console.log('Connection closed.');
```

```js [JavaScript]
// connect.js
import {Dockline} from '@jalsoedesign/dockline-core';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD and SFTP_SHA256.');
}

const connection = {
    protocol: 'sftp',
    host: SFTP_HOST,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === SFTP_HOST &&
        challenge.port === 22 &&
        challenge.fingerprint === SFTP_SHA256
    ),
    acceptTrustPolicy: () => false,
};

await Dockline.withConnection(connection, async remote => {
    for await (const entry of remote.list('.')) {
        console.log(entry.path, entry.type);
    }

    console.log('Directory listed.');
});

console.log('Connection closed.');
```

```js [MJS]
// connect.mjs
import {Dockline} from '@jalsoedesign/dockline-core';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD and SFTP_SHA256.');
}

const connection = {
    protocol: 'sftp',
    host: SFTP_HOST,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === SFTP_HOST &&
        challenge.port === 22 &&
        challenge.fingerprint === SFTP_SHA256
    ),
    acceptTrustPolicy: () => false,
};

await Dockline.withConnection(connection, async remote => {
    for await (const entry of remote.list('.')) {
        console.log(entry.path, entry.type);
    }

    console.log('Directory listed.');
});

console.log('Connection closed.');
```

```js [CommonJS]
// connect.cjs
const {Dockline} = require('@jalsoedesign/dockline-core');

async function main() {
    const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

    if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
        throw new Error('Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD and SFTP_SHA256.');
    }

    const connection = {
        protocol: 'sftp',
        host: SFTP_HOST,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => (
            challenge.host === SFTP_HOST &&
            challenge.port === 22 &&
            challenge.fingerprint === SFTP_SHA256
        ),
        acceptTrustPolicy: () => false,
    };

    await Dockline.withConnection(connection, async remote => {
        for await (const entry of remote.list('.')) {
            console.log(entry.path, entry.type);
        }

        console.log('Directory listed.');
    });

    console.log('Connection closed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

Port 22 is the default. If you select another port, add it to the configuration and update the port comparison in the trust check.

## Run it

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx connect.ts
```

```sh [JavaScript]
npm pkg set type=module
node connect.js
```

```sh [MJS]
node connect.mjs
```

```sh [CommonJS]
node connect.cjs
```

:::

## Output

Example output, with directory entries that depend on your account:

```text
./reports directory
./hello.txt file
Directory listed.
Connection closed.
```

The example prints entry metadata and completion messages explicitly. `withConnection` authenticates, awaits the callback and disconnects even when work fails. Consume streams and iterators inside its callback.

## Transfer your first file

Create a file named `hello.txt` in your working directory. Replace the listing inside the same connected callback with the recipe below. Keep the filename and run command from the selected language tab above; this fragment is not a separate program:

::: code-group

```ts [TypeScript]
// Upload local file './hello.txt' to 'dockline-hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-hello.txt');
console.log('Uploaded dockline-hello.txt.');

// Download 'dockline-hello.txt' from the server
// to './downloaded-hello.txt' on the host.
await remote.downloadFile('dockline-hello.txt', './downloaded-hello.txt');
console.log('Downloaded downloaded-hello.txt.');
```

```js [JavaScript]
// Upload local file './hello.txt' to 'dockline-hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-hello.txt');
console.log('Uploaded dockline-hello.txt.');

// Download 'dockline-hello.txt' from the server
// to './downloaded-hello.txt' on the host.
await remote.downloadFile('dockline-hello.txt', './downloaded-hello.txt');
console.log('Downloaded downloaded-hello.txt.');
```

```js [MJS]
// Upload local file './hello.txt' to 'dockline-hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-hello.txt');
console.log('Uploaded dockline-hello.txt.');

// Download 'dockline-hello.txt' from the server
// to './downloaded-hello.txt' on the host.
await remote.downloadFile('dockline-hello.txt', './downloaded-hello.txt');
console.log('Downloaded downloaded-hello.txt.');
```

```js [CommonJS]
// Upload local file './hello.txt' to 'dockline-hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'dockline-hello.txt');
console.log('Uploaded dockline-hello.txt.');

// Download 'dockline-hello.txt' from the server
// to './downloaded-hello.txt' on the host.
await remote.downloadFile('dockline-hello.txt', './downloaded-hello.txt');
console.log('Downloaded downloaded-hello.txt.');
```

:::

These lines print:

```text
Uploaded dockline-hello.txt.
Downloaded downloaded-hello.txt.
```

Choose a remote filename you intend to write: ordinary uploads replace that name. Downloads refuse an existing local destination; remove your test copy or explicitly pass `{overwrite: 'replace'}` when rerunning. Local and remote parent directories must exist.

## If it does not connect

| Message or symptom | Next step |
| --- | --- |
| Missing environment settings | Set all four variables in the terminal running Node. |
| Host trust rejected | Check the verified fingerprint and port. Do not replace the pin with an unverified value. |
| Authentication rejected | Check the account/password or follow [private-key authentication](/guide/sftp). |
| Directory permission denied | Use a directory your account can read; configure a supported remote `root` if needed. |

Next: [everyday file recipes](/api/files), [private keys and agents](/guide/sftp), [FTP/FTPS](/ftp/quick-start), or [exact methods and defaults](/reference/api).
