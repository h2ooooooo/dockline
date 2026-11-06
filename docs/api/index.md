# API documentation

Use Node.js to transfer files over FTP, FTPS or SFTP, or run commands over SSH. The API returns promises, streams and metadata; examples print results explicitly so completion is visible.

## Get a first result

| Step | What you will do |
| --- | --- |
| [Install the packages](/guide/installation) | Select core and a protocol client, or the independent SSH client. |
| [Connect and list files](/api/quick-start) | Save one file, set connection variables, run it and compare output. |
| [Try a local server instead](/api/local-demo) | Run disposable fixtures when no server account is available. |
| [Choose an example language](/guide/code-examples) | Use TypeScript by default or matching JavaScript, MJS and CommonJS tabs. |

## Common tasks

| Task | Guide |
| --- | --- |
| Upload, download, list, rename and remove files | [Everyday file operations](/api/files) |
| Transfer a file over FTP or FTPS | [FTP walkthrough](/ftp/quick-start) |
| Transfer a file over SFTP | [SFTP walkthrough](/sftp/quick-start) |
| Run a remote command and read its exit status | [SSH walkthrough](/ssh/quick-start) |
| Build or embed a terminal command | [CLI integration](/guide/cli-integration) |
| Inspect or convert keys without a connection | [Keys documentation](/keys/) |

## Add control when needed

After the first operation works, configure [passwords, keys or agents](/guide/sftp), [verified host trust](/guide/trust), [timeouts and transfer limits](/guide/configuration), [streams and session ownership](/guide/usage), [publication and checksums](/guide/advanced-transfers), and [connection pools](/guide/pools). Use [typed errors](/guide/errors) to choose recovery behavior.

## Look up a contract

[Methods and defaults](/reference/api) explain behavior. [TypeScript declarations](/reference/types) list exact exported signatures. [Packages and architecture](/guide/packages) explain the independently usable clients and shared contracts.
