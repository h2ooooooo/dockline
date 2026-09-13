# Choose your quick start

Choose the protocol your server uses. Each guide starts with a complete connection, uploads a local file, downloads it again and closes the connection. Then it shows listing, file information, folders, text, rename and delete operations.

| Your server | Start here | More detail |
| --- | --- | --- |
| FTP or FTP over TLS (FTPS) | [Quick start FTP](/ftp/quick-start) | [Connection settings and FTPS](/guide/ftp) |
| SSH File Transfer Protocol (SFTP) | [Quick start SFTP](/sftp/quick-start) | [Authentication](/guide/sftp) · [Host trust](/guide/trust) |

FTP and SFTP have separate sections in the navigation. Both use `Dockline.connect`, `downloadFile` and `uploadFile`; the connection settings select the protocol. SFTP uses SSH, while FTPS adds TLS to FTP.

Install [core plus the matching protocol client](/guide/installation) first; both clients are optional and must be selected explicitly. For options that apply to both protocols, see [configuration](/guide/configuration), [everyday usage](/guide/usage) and [using Dockline in your own CLI](/guide/cli).
