# Quick start FTP

Connect to an FTP server, upload a local file, and download it again with the same Dockline session. The same methods work with FTPS.

For terminal commands instead of application code, use the optional [Dockline CLI](/guide/cli).

## Connect and transfer a file

Install [core and the FTP client](/guide/installation#ftp-and-ftps), put a file named `hello.txt` in your working directory, and supply `FTP_HOST`, `FTP_USERNAME` and `FTP_PASSWORD` through your environment. Use an account with permission to write in its starting directory, or set `FTP_ROOT` to a writable remote folder that already exists.

```ts
import {mkdir} from 'node:fs/promises';
import {Dockline, type FtpTransferConfig} from '@dockline/core';

function requiredEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} before running this example`);
    }

    return value;
}

const connection: FtpTransferConfig = {
    protocol: 'ftp',
    host: requiredEnv('FTP_HOST'),
    username: requiredEnv('FTP_USERNAME'),
    password: requiredEnv('FTP_PASSWORD'),
    root: process.env.FTP_ROOT ?? '',
};

await mkdir('./downloads', {recursive: true});

const remote = await Dockline.connect(connection);

try {
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    await remote.downloadFile('dockline-example.txt', './downloads/dockline-example.txt', {
        overwrite: 'replace',
    });

    console.log('Uploaded hello.txt and downloaded a copy into downloads.');
} finally {
    await remote.disconnect();
}
```

`Dockline.connect()` waits for login and directory setup. The `finally` block closes the connection even if a transfer fails. This example replaces the remote `dockline-example.txt` and explicitly allows replacing its local downloaded copy, so it can be run again.

Remote paths are relative to `root` and always use `/`. With an empty `root`, FTP starts in the account's login directory. Local paths are relative to your process's working directory.

### FTP or FTPS

Choose the mode your server supports by changing `connection.protocol`; the transfer code stays the same.

| `protocol` | Connection | Default port |
| --- | --- | --- |
| `'ftp'` | Plain FTP; credentials and files are unencrypted | 21 |
| `'ftps'` | Explicit TLS | 21 |
| `'ftps-implicit'` | TLS from the start of the connection | 990 |

Set `port` in the configuration if your server uses another port. FTPS verifies the server certificate. For a private certificate authority, see [FTP connection options](/guide/ftp) and [certificate trust](/guide/trust#ftps-certificate-trust).

## Fetch a remote file to your computer

The recipes below belong inside the connected `try` block above. Use filenames you have created or selected.

```ts
await remote.downloadFile('dockline-example.txt', './downloads/another-copy.txt');
```

The arguments are **remote source first, local destination second**. The local parent directory must exist. Downloads refuse to replace an existing local file by default; pass `{overwrite: 'replace'}` when replacement is intended. A download is staged locally and published after it completes. Downloads have no size limit by default. Set `maxBytes` on the connection or this call when you want a limit; see [download options](/guide/usage#downloads).

## Save a local file on the server

```ts
await remote.uploadFile('./hello.txt', 'dockline-another-upload.txt');
```

The arguments are **local source first, remote destination second**. The remote parent directory must exist. Uploads replace the remote file by default, and an interrupted ordinary upload can leave partial remote content. FTP cannot guarantee no-replace uploads. See [staged publication](/guide/advanced-transfers) for uploading before publishing a remote name.

## List files and directories

```ts
for await (const entry of remote.list('.')) {
    console.log(entry.path, entry.type);
}
```

`.` selects the configured root. Listing is shallow by default; use `remote.list('.', {deep: true})` for recursive listing, or [bounded traversal](/guide/advanced-transfers) when you need limits and a completion result.

## Check a file's details

```ts
const details = await remote.stat('dockline-example.txt');

if (details.type === 'file') {
    console.log(details.path, details.size);
}
```

`stat()` returns the entry's type and available metadata. Missing files, inaccessible paths and connection failures are errors; handle them through the [error API](/guide/errors).

## Create a remote directory

```ts
await remote.createDirectory('dockline-example');
await remote.uploadFile('./hello.txt', 'dockline-example/hello.txt');
```

`createDirectory()` creates missing parent directories too. It does not change the configured root.

## Write and read text

```ts
await remote.write('dockline-notes.txt', 'Hello from Dockline\n');

const stream = await remote.read('dockline-notes.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

`write()` accepts a string, Buffer or stream. `read()` returns a Node readable stream, so consume it fully before disconnecting. Use `uploadFile()` and `downloadFile()` when both ends of your operation are filenames.

## Rename a remote file

After creating `dockline-notes.txt` in the previous recipe:

```ts
await remote.rename('dockline-notes.txt', 'dockline-notes-renamed.txt', {
    overwrite: 'replace',
});
```

FTP requires explicit replacement permission and cannot guarantee an atomic rename. The destination may be replaced. `overwrite: 'fail'` and `requireAtomicRename: true` are unsupported for FTP and are rejected before the rename.

## Delete a remote file

To remove the example file after renaming it:

```ts
await remote.deleteFile('dockline-notes-renamed.txt');
```

This removes that remote file. `deleteFile()` does not remove directories; advanced directory operations are available through the [underlying connector](/guide/usage#advanced-access).

## Let Dockline close the session

For a short job, replace the explicit connection and `try`/`finally` with `withConnection()`:

```ts
await Dockline.withConnection(connection, async remote => {
    await remote.uploadFile('./hello.txt', 'dockline-example.txt');

    await remote.downloadFile('dockline-example.txt', './downloads/dockline-example.txt', {
        overwrite: 'replace',
    });
});
```

The callback has the same connected API. Dockline disconnects after it finishes, including failure paths. Finish consuming streams and iterators inside the callback.

Continue with [FTP connection and transfer options](/guide/ftp), [shared configuration and retries](/guide/configuration), or the [SFTP quick start](/sftp/quick-start).
