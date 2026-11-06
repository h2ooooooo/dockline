# Everyday file operations

All examples below run inside `Dockline.withConnection(config, async remote => {... })`. Start with the [complete runnable example](/api/quick-start) for setup and exact output, or use the [FTP](/ftp/quick-start) / [SFTP](/sftp/quick-start) connection walkthrough for your own server.

For file transfers, the first path is always the **source** and the second is the **destination**:

| Method | Source (first argument) | Destination (second argument) |
| --- | --- | --- |
| `uploadFile(localPath, remotePath)` | File on the host | File on the server |
| `downloadFile(remotePath, localPath)` | File on the server | File on the host |

Local relative paths start from your Node.js process's working directory. Remote relative paths use the session's remote root. The transfer comments below name both ends explicitly.

## Upload and inspect

::: code-group

```ts [TypeScript]
// Upload local file './hello.txt' to 'hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'hello.txt');
const details = await remote.stat('hello.txt');
console.log(details.size);
```

```js [JavaScript]
// Upload local file './hello.txt' to 'hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'hello.txt');
const details = await remote.stat('hello.txt');
console.log(details.size);
```

```js [MJS]
// Upload local file './hello.txt' to 'hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'hello.txt');
const details = await remote.stat('hello.txt');
console.log(details.size);
```

```js [CommonJS]
// Upload local file './hello.txt' to 'hello.txt' on the server.
await remote.uploadFile('./hello.txt', 'hello.txt');
const details = await remote.stat('hello.txt');
console.log(details.size);
```

:::

With the 21-byte quick-start input, this prints `21`. Upload takes the local source first and replaces an existing remote file by default. Stat returns metadata; it does not print it.

## Download and verify

::: code-group

```ts [TypeScript]
// Download 'hello.txt' from the server
// to './downloads/hello.txt' on the host.
await remote.downloadFile('hello.txt', './downloads/hello.txt');
```

```js [JavaScript]
// Download 'hello.txt' from the server
// to './downloads/hello.txt' on the host.
await remote.downloadFile('hello.txt', './downloads/hello.txt');
```

```js [MJS]
// Download 'hello.txt' from the server
// to './downloads/hello.txt' on the host.
await remote.downloadFile('hello.txt', './downloads/hello.txt');
```

```js [CommonJS]
// Download 'hello.txt' from the server
// to './downloads/hello.txt' on the host.
await remote.downloadFile('hello.txt', './downloads/hello.txt');
```

:::

Download takes the remote source first. Create the local parent directory first. The promise resolves after staging, publication and cleanup; default overwrite is `fail`. For a repeated download, select `{overwrite: 'replace'}` explicitly. See [session and transfer rules](/guide/usage) for byte limits and partial-failure behavior.

## List a directory

::: code-group

```ts [TypeScript]
for await (const entry of remote.list('notes')) {
    console.log(entry.path, entry.type);
}
```

```js [JavaScript]
for await (const entry of remote.list('notes')) {
    console.log(entry.path, entry.type);
}
```

```js [MJS]
for await (const entry of remote.list('notes')) {
    console.log(entry.path, entry.type);
}
```

```js [CommonJS]
for await (const entry of remote.list('notes')) {
    console.log(entry.path, entry.type);
}
```

:::

Listing yields entries asynchronously and is shallow by default. Paths/types come from the adapter; ordering and optional metadata can differ across servers. For bounded recursive enumeration and a completion result, use [walk](/guide/advanced-transfers).

## Create a directory and read text

::: code-group

```ts [TypeScript]
await remote.createDirectory('notes');
await remote.write('notes/readme.txt', 'Hello from a stream\n');
const stream = await remote.read('notes/readme.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [JavaScript]
await remote.createDirectory('notes');
await remote.write('notes/readme.txt', 'Hello from a stream\n');
const stream = await remote.read('notes/readme.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [MJS]
await remote.createDirectory('notes');
await remote.write('notes/readme.txt', 'Hello from a stream\n');
const stream = await remote.read('notes/readme.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

```js [CommonJS]
await remote.createDirectory('notes');
await remote.write('notes/readme.txt', 'Hello from a stream\n');
const stream = await remote.read('notes/readme.txt');

stream.setEncoding('utf8');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

:::

Output:

```text
Hello from a stream
```

Finish reading before the scoped connection closes. A caller-owned consumed stream cannot be replayed; use a fresh-stream factory when eligible retries need a replayable source.

## Rename and remove

::: code-group

```ts [TypeScript]
// Rename server source 'hello.txt' to server destination 'renamed.txt'.
await remote.rename('hello.txt', 'renamed.txt', {overwrite: 'replace'});
await remote.deleteFile('renamed.txt');
console.log('Removed renamed.txt');
```

```js [JavaScript]
// Rename server source 'hello.txt' to server destination 'renamed.txt'.
await remote.rename('hello.txt', 'renamed.txt', {overwrite: 'replace'});
await remote.deleteFile('renamed.txt');
console.log('Removed renamed.txt');
```

```js [MJS]
// Rename server source 'hello.txt' to server destination 'renamed.txt'.
await remote.rename('hello.txt', 'renamed.txt', {overwrite: 'replace'});
await remote.deleteFile('renamed.txt');
console.log('Removed renamed.txt');
```

```js [CommonJS]
// Rename server source 'hello.txt' to server destination 'renamed.txt'.
await remote.rename('hello.txt', 'renamed.txt', {overwrite: 'replace'});
await remote.deleteFile('renamed.txt');
console.log('Removed renamed.txt');
```

:::

Output: `Removed renamed.txt`. Rename requires an explicit overwrite policy. FTP supports explicit replacement but cannot guarantee no-replace rename. SFTP replacement requires the server's OpenSSH rename extension; it can alternatively request no-replace behavior. The API refuses unsupported guarantees. Delete removes a file. Review [advanced transfers](/guide/advanced-transfers) for publication and directory operations.
