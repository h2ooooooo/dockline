---
layout: home
hero:
  name: Dockline
  text: Transfer files. Run SSH commands. Work with keys.
  tagline: Use a consistent transfer API across FTP, FTPS and SFTP, alongside SSH commands and independent key tools.
  actions:
    - theme: brand
      text: API documentation
      link: /api/
    - theme: alt
      text: CLI documentation
      link: /cli/
    - theme: alt
      text: Keys documentation
      link: /keys/
---

Source code: [GitHub repository](https://github.com/h2ooooooo/dockline).

FTP, FTPS and SFTP clients often expose different ways to perform the same file operations. Dockline gives scripts a consistent transfer API, with a separate SSH client for remote commands. Start with the API, use the terminal CLI, or install only the key library for key operations.

## API documentation

Connect over FTP, FTPS or SFTP to upload, download and manage files. Use the separate SSH client to execute commands. Start with a complete TypeScript example, or select JavaScript, MJS or CommonJS.

[Explore the API](/api/) · [Install](/guide/installation) · [First connection](/api/quick-start) · [Try a local server](/api/local-demo)

## CLI documentation

Transfer files directly from a terminal. Configure a connection once, then upload, download, list or remove files. Each command guide shows its input, output and defaults.

[Explore the CLI](/cli/) · [First terminal transfer](/cli/quick-start) · [Commands](/cli/commands) · [Output and exit codes](/cli/output)

## Keys documentation

Inspect, fingerprint and convert SSH keys without connecting to a server. Read PuTTY PPK v2/v3, OpenSSH and supported PEM formats, extract public keys and export encrypted private keys. Install only `@jalsoedesign/dockline-keys` for these operations.

[Explore Keys](/keys/) · [First key inspection](/keys/quick-start) · [Convert and encrypt](/keys/convert) · [Supported formats](/keys/formats)

## Start without a server account

The [local demos](/api/local-demo) start disposable loopback servers and check actual transferred bytes. Published packages need no source checkout; only the repository's development fixtures require one.

Throughout these docs, **the host** means the machine running Node.js or the CLI; **the server** means the remote FTP/SSH endpoint. File-transfer examples name both the source and destination.
