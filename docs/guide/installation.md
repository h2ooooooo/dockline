# Install Dockline

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and npm `>=12.0.2`. Packages are ESM with TypeScript declarations; examples default to TypeScript, with JavaScript, MJS and CommonJS alternatives. [Language setup](/guide/code-examples) shows the corresponding run commands.

## Choose what you want to do

| Your task | Install | Start using it |
| --- | --- | --- |
| SFTP file operations in code | `npm install @jalsoedesign/dockline-core @jalsoedesign/dockline-sftp-client` | [API quick start](/api/quick-start) |
| FTP/FTPS file operations in code | `npm install @jalsoedesign/dockline-core @jalsoedesign/dockline-ftp-client` | [FTP/FTPS walkthrough](/ftp/quick-start) |
| SSH commands | `npm install @jalsoedesign/dockline-ssh-client` | [SSH quick start](/ssh/quick-start) |
| Key inspection/conversion | `npm install @jalsoedesign/dockline-keys` | [Key utilities](/keys/) |

For terminal commands use the separate [CLI quick start](/cli/quick-start). Install its chosen client beside the CLI, either both globally or both locally.

## SFTP

Core supplies the common file methods; the SFTP client supplies the transport. Install both with the first command above. Configure verified host identity and your selected authentication; [the quick start](/api/quick-start) includes the complete setup.

## FTP and FTPS

The FTP client handles plaintext FTP, explicit FTPS and implicit FTPS. Select the server's protocol explicitly. [The walkthrough](/ftp/quick-start) explains the ports and certificate verification.

## Saved application settings

Install the selected native reader, `@jalsoedesign/portline-dockline` and the required Dockline protocol client. Metadata-only readers do not need transport dependencies. The [saved-profile integration guide](/guide/saved-profiles) separates native parsing, credential/trust providers, shared conversion and network execution.

The main Dockline factory handles FTP/FTPS/SFTP. SSH commands use the independently installed `SshClient` API or the shared bridge's `withSsh`; they are not another `TransferConfig` protocol.

## TypeScript

Use `module` and `moduleResolution` set to `NodeNext`, Node types, and the appropriate ESM configuration. Dockline includes declarations. Use the TypeScript tab in the [quick start](/api/quick-start), or choose the JavaScript tab for a project without TypeScript.

## Need lower-level control?

Use [direct protocol adapters and shared contracts](/guide/packages) when you need their underlying APIs. Core's clients are optional peers; install the transport you choose. Dockline never downloads a missing client automatically.

## Working on Dockline itself

Cloning, source builds and documentation development are [contributor tasks](/development/compiler). For a disposable local server, follow [the optional demo](/api/local-demo).
