# CLI integration

Use `@dockline/core` directly when your application owns argument parsing, credential lookup and host approval. Use the optional `@dockline/cli` package when you want to embed Dockline's existing command surface. The [ready-to-use CLI](/guide/cli) is available separately; SDK users do not need to install it.

## A small command

Save this as `upload.mjs` in an ESM project with `@dockline/core` and `@dockline/sftp-client` installed. The host fingerprint must have been verified independently; this unattended example refuses unknown keys.

```js
import {Dockline} from '@dockline/core';

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
        await remote.uploadFile(localPath, remotePath);
    });
} finally {
    process.removeListener('SIGINT', cancel);
}
```

```sh
node upload.mjs ./hello.txt uploads/hello.txt
```

An interactive CLI can provide a `credentialProvider` with masked input and a [known-hosts store](/guide/trust) backed by its own approval UI. Honor callback cancellation so an expired request does not leave a pending prompt. Environment variables are an example input mechanism, not a credential vault; choose storage appropriate to your application.

Catch [typed errors](/guide/errors) to choose exit codes and concise messages. Wait for transfers and cleanup before exiting. Do not call `process.exit()` while writes are still in flight.


## Embed the packaged CLI

Install `@dockline/cli` and the clients used by your application. `runCli()` accepts command arguments without the Node executable or script filename and resolves to an exit code:

```ts
import {runCli} from '@dockline/cli';

const exitCode = await runCli([
    'download',
    '--source-file',
    '/home/ftp/blabla.txt',
    '--destination-file',
    './downloads/blabla.txt',
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

Omitted arguments default to `process.argv.slice(2)`. The runner waits for operation and connection cleanup. It does not force the hosting process to exit. Your application owns signal listeners when embedding; provide an `AbortSignal` through `context.signal` for cancellation. The standalone `dockline` executable supplies its own signal handling.

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
