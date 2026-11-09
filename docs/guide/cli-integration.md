# CLI integration

Build a custom command around `@jalsoedesign/dockline-core` when argument parsing, credential lookup and host approval belong to the caller. For saved application settings, prepare connections through the [shared Portline bridge](/guide/saved-profiles). Use the optional `@jalsoedesign/dockline-cli` package when you want to embed Dockline's existing command surface. The [ready-to-use CLI](/guide/cli) is available separately; SDK users do not need to install it.

## A small command

Install `@jalsoedesign/dockline-core` and `@jalsoedesign/dockline-sftp-client`. TypeScript is the default: save `upload.ts`, or use the filename shown in the selected language tab. See [language and module setup](/guide/code-examples) for the alternatives. The host fingerprint must have been verified independently; this unattended example refuses unknown keys.

::: code-group

```ts [TypeScript]
// upload.ts
import {Dockline} from '@jalsoedesign/dockline-core';

const [localPath, remotePath] = process.argv.slice(2);
const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!localPath || !remotePath || !SFTP_HOST || !SFTP_USERNAME || !SFTP_SHA256) {
    throw new Error('Supply local/remote paths and SFTP_HOST, SFTP_USERNAME, SFTP_SHA256');
}

const controller = new AbortController();
const cancel = () => controller.abort();

process.once('SIGINT', cancel);

try {
    await Dockline.withConnection({
        protocol: 'sftp',
        host: SFTP_HOST,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        abortSignal: controller.signal,
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => challenge.fingerprint === SFTP_SHA256,
        acceptTrustPolicy: () => false,
    }, async remote => {
        // Upload local file localPath to remotePath on the server.
        await remote.uploadFile(localPath, remotePath);
    });
} finally {
    process.removeListener('SIGINT', cancel);
}
```

```js [JavaScript]
// upload.js
import {Dockline} from '@jalsoedesign/dockline-core';

const [localPath, remotePath] = process.argv.slice(2);
const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!localPath || !remotePath || !SFTP_HOST || !SFTP_USERNAME || !SFTP_SHA256) {
    throw new Error('Supply local/remote paths and SFTP_HOST, SFTP_USERNAME, SFTP_SHA256');
}

const controller = new AbortController();
const cancel = () => controller.abort();

process.once('SIGINT', cancel);

try {
    await Dockline.withConnection({
        protocol: 'sftp',
        host: SFTP_HOST,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        abortSignal: controller.signal,
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => challenge.fingerprint === SFTP_SHA256,
        acceptTrustPolicy: () => false,
    }, async remote => {
        // Upload local file localPath to remotePath on the server.
        await remote.uploadFile(localPath, remotePath);
    });
} finally {
    process.removeListener('SIGINT', cancel);
}
```

```js [MJS]
// upload.mjs
import {Dockline} from '@jalsoedesign/dockline-core';

const [localPath, remotePath] = process.argv.slice(2);
const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!localPath || !remotePath || !SFTP_HOST || !SFTP_USERNAME || !SFTP_SHA256) {
    throw new Error('Supply local/remote paths and SFTP_HOST, SFTP_USERNAME, SFTP_SHA256');
}

const controller = new AbortController();
const cancel = () => controller.abort();

process.once('SIGINT', cancel);

try {
    await Dockline.withConnection({
        protocol: 'sftp',
        host: SFTP_HOST,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        abortSignal: controller.signal,
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => challenge.fingerprint === SFTP_SHA256,
        acceptTrustPolicy: () => false,
    }, async remote => {
        // Upload local file localPath to remotePath on the server.
        await remote.uploadFile(localPath, remotePath);
    });
} finally {
    process.removeListener('SIGINT', cancel);
}
```

```js [CommonJS]
// upload.cjs
const {Dockline} = require('@jalsoedesign/dockline-core');

async function main() {
    const [localPath, remotePath] = process.argv.slice(2);
    const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

    if (!localPath || !remotePath || !SFTP_HOST || !SFTP_USERNAME || !SFTP_SHA256) {
        throw new Error('Supply local/remote paths and SFTP_HOST, SFTP_USERNAME, SFTP_SHA256');
    }

    const controller = new AbortController();
    const cancel = () => controller.abort();

    process.once('SIGINT', cancel);

    try {
        await Dockline.withConnection({
            protocol: 'sftp',
            host: SFTP_HOST,
            username: SFTP_USERNAME,
            password: SFTP_PASSWORD,
            abortSignal: controller.signal,
            requireTrustPolicy: true,
            hasTrustPolicy: challenge => challenge.fingerprint === SFTP_SHA256,
            acceptTrustPolicy: () => false,
        }, async remote => {
            // Upload local file localPath to remotePath on the server.
            await remote.uploadFile(localPath, remotePath);
        });
    } finally {
        process.removeListener('SIGINT', cancel);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx upload.ts ./hello.txt uploads/hello.txt
```

```sh [JavaScript]
npm pkg set type=module
node upload.js ./hello.txt uploads/hello.txt
```

```sh [MJS]
node upload.mjs ./hello.txt uploads/hello.txt
```

```sh [CommonJS]
node upload.cjs ./hello.txt uploads/hello.txt
```

:::

These commands upload local source `./hello.txt` on the host to destination `uploads/hello.txt` on the server. Create the remote `uploads` directory first and supply the SFTP environment variables shown in the [API quick start](/api/quick-start#set-your-connection-details). A successful upload prints nothing and exits with code `0`; a failure prints an error and exits with a nonzero code.

An interactive CLI can provide a `credentialProvider` with masked input and a [known-hosts store](/guide/trust) backed by its own approval UI. Honor callback cancellation so an expired request does not leave a pending prompt. Environment variables are an example input mechanism, not a credential vault; choose appropriate credential storage.

Catch [typed errors](/guide/errors) to choose exit codes and concise messages. Wait for transfers and cleanup before exiting. Do not call `process.exit()` while writes are still in flight.

## Embed the packaged CLI

Install `@jalsoedesign/dockline-cli` and the required protocol clients. `runCli()` accepts command arguments without the Node executable or script filename and resolves to an exit code:

::: code-group

```ts [TypeScript]
// embedded-cli.ts
import {runCli} from '@jalsoedesign/dockline-cli';

// Download server source hello.txt to host destination ./downloaded-hello.txt.
const exitCode = await runCli([
    'download',
    '--source-file',
    'hello.txt',
    '--destination-file',
    './downloaded-hello.txt',
    '--config',
    'dockline.server.yml',
], {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exitCode = exitCode;
```

```js [JavaScript]
// embedded-cli.js
import {runCli} from '@jalsoedesign/dockline-cli';

// Download server source hello.txt to host destination ./downloaded-hello.txt.
const exitCode = await runCli([
    'download',
    '--source-file',
    'hello.txt',
    '--destination-file',
    './downloaded-hello.txt',
    '--config',
    'dockline.server.yml',
], {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exitCode = exitCode;
```

```js [MJS]
// embedded-cli.mjs
import {runCli} from '@jalsoedesign/dockline-cli';

// Download server source hello.txt to host destination ./downloaded-hello.txt.
const exitCode = await runCli([
    'download',
    '--source-file',
    'hello.txt',
    '--destination-file',
    './downloaded-hello.txt',
    '--config',
    'dockline.server.yml',
], {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exitCode = exitCode;
```

```js [CommonJS]
// embedded-cli.cjs
const {runCli} = require('@jalsoedesign/dockline-cli');

async function main() {
    // Download server source hello.txt to host destination ./downloaded-hello.txt.
    const exitCode = await runCli([
        'download',
        '--source-file',
        'hello.txt',
        '--destination-file',
        './downloaded-hello.txt',
        '--config',
        'dockline.server.yml',
    ], {
        cwd: process.cwd(),
        env: process.env,
        stdout: process.stdout,
        stderr: process.stderr,
    });

    process.exitCode = exitCode;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

### Run the embedded command

Save `embedded-cli.ts` or the filename in the selected tab. Use the [quick-start connection file](/cli/quick-start#save-dockline-server-yml), a server file named `hello.txt`, and a host working directory without `downloaded-hello.txt`. This program uses the same trust checks, overwrite policy and exit codes as the terminal command.

Download: <a href="/examples/embedded-cli.ts" download="embedded-cli.ts">TypeScript</a> · <a href="/examples/embedded-cli.js" download="embedded-cli.js">JavaScript</a> · <a href="/examples/embedded-cli.mjs" download="embedded-cli.mjs">MJS</a> · <a href="/examples/embedded-cli.cjs" download="embedded-cli.cjs">CommonJS</a>

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx embedded-cli.ts
```

```sh [JavaScript]
npm pkg set type=module
node embedded-cli.js
```

```sh [MJS]
node embedded-cli.mjs
```

```sh [CommonJS]
node embedded-cli.cjs
```

:::

For the 20-byte CLI quick-start input, successful output on Windows has this shape (the absolute local path varies):

```text
Downloaded 20 bytes: hello.txt -> <working-directory>\downloaded-hello.txt
```

Omitted arguments default to `process.argv.slice(2)`. The runner waits for operation and connection cleanup. It does not force the hosting process to exit. When embedding, register signal listeners and provide an `AbortSignal` through `context.signal` for cancellation. The standalone `dockline` executable supplies its own signal handling.

`CliContext` accepts optional `cwd`, `env`, `stdin`, `stdout`, `stderr` and `signal`. This supports controlled input/output for tests or another terminal interface. Interactive host approval depends on the supplied terminal streams; a noninteractive unknown host is rejected.

| Export | Contract |
| --- | --- |
| `runCli(argv?: readonly string[], context?: CliContext)` | `Promise<number>`; parse, run, report and clean up, returning the CLI exit code. |
| `createProgram(context?: CliContext)` | A Commander `Command` configured with Dockline's commands and context. |
| `loadCliConfig(filename, {cwd?, env?}?)` | `Promise<LoadedCliConfig>`; parse and validate YAML, expand environment values and resolve configuration-relative files. |
| `LoadedCliConfig` | Resolved connection, optional CLI trust config, defaults, per-command settings and absolute `configFile`. |
| `CliCommandDefaults` | Optional source/destination/path, overwrite, recursion, traversal budgets and supported shared operation settings. |
| `resolveCliCommandDefaults(config, command)` | Merge shared and selected-command YAML defaults, resolving that command's local path before CLI overrides. |
| `CliCommand`, `CliCommandOptions`, `CliTrustConfig` | Command-name union, serializable operation settings and fingerprint/store trust settings. |
| `CliResult` | Discriminated success-result union for upload/download, list and remove. |
| `CliConfigError`, `CliUsageError` | Configuration/usage failures; the normal runner reports exit code `2`. `CliUsageError` has code `DOCKLINE_USAGE_ERROR`. |

Use `runCli()` when you want the packaged command's normal output and exit-code handling. The configuration loader performs no transfer or host approval by itself. Callable credential providers and custom interactive UI flows remain an SDK integration concern rather than YAML values.
