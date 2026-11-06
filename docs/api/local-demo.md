# Try a local server

Upload a file, inspect its size, download it again, then rename and remove it. This example starts a temporary FTP server on the host and uses the public Dockline API. It needs no account, Docker installation or installed FTP application.

## Prepare the source checkout

These optional demos use the development fixtures in the Dockline repository. Clone the repository and install its dependencies before running them. They are separate from using the published packages.

```sh
git clone https://github.com/h2ooooooo/dockline.git
cd dockline
npm ci
```

Then run:

```sh
npm run build
node examples/test-api.mjs ftp
```

## What the fixture runs

The repository's `examples/test-api.mjs` is a development harness: it starts the server, calls the public API and asserts the result. Run that existing filename with the commands above; it is not a language-tab program to rename. For a copy-and-save example in TypeScript, JavaScript, MJS or CommonJS, use [the API quick start](/api/quick-start) or [FTP walkthrough](/ftp/quick-start).

The fixture uploads host `input.txt` to server `hello.txt`, then downloads that server file to host `output.txt`. All three paths are inside disposable fixture storage. It also checks listing, renaming, deletion and streams, and removes its temporary files afterward.

## Output

```text
Uploaded hello.txt
Remote size: 21
Downloaded identical content
Renamed hello.txt to renamed.txt
Removed renamed.txt
Hello from a stream
Listed: readme.txt
Connection closed
Local server stopped
Temporary files removed.
```

The example explicitly prints these lines; the SDK methods themselves return promises, metadata or streams. A nonzero exit means an operation or assertion failed. Every transfer targets the disposable loopback server.

## Use the same pattern elsewhere

`withConnection` closes the session after the callback settles. Consume streams and iterators inside that callback. Uploads replace existing remote files by default; downloads refuse existing local files. Both parent directories must already exist. This fixture starts empty, so it does not need replacement downloads.

SDK remote paths are relative to `root` and use `/`. The FTP fixture is deliberately local and unencrypted. For your own server use its configured [FTPS](/guide/ftp) or [SFTP with verified host identity](/sftp/quick-start) settings.

Next: [everyday operations](/api/files), [run SFTP, SSH and key examples](/api/examples), or [method reference](/reference/api).

The [CLI local-server demo](/guide/local-demo) invokes actual terminal commands. [More local examples](/api/examples) cover SFTP, SSH and encrypted keys.
