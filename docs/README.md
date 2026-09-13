# Documentation source

This directory contains Dockline's independently installed VitePress site. Start at the [documentation index](./index.md), [Quick start FTP](./ftp/quick-start.md), [Quick start SFTP](./sftp/quick-start.md), [package layout](./guide/packages.md), [CLI](./guide/cli.md), [public API](./reference/api.md) or [behavior specification](./spec/architecture.md).

From the repository root run `npm run docs:install`, then `npm run docs:dev` or `npm run docs:build`. The site has one Sunset theme and local search. See [documentation maintenance](./development/testing.md#vitepress-workflow) for contribution and verification requirements.

The documentation project is private and is not part of the five package tarballs. Package installation and distribution are described in [installation](./guide/installation.md) and [compiler/package build](./development/compiler.md).

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys documentation on every push to `main`. It can also be started manually from the Actions tab on `main`.

Enable **Settings → Pages → Build and deployment → Source → GitHub Actions** in the repository before the first deployment. The workflow uses GitHub's generated token; no personal deployment token or npm publishing credentials are needed.

The workflow installs the locked documentation dependencies, audits them, builds VitePress and deploys the generated site through the `github-pages` environment. Its deployment URL is shown in the workflow result. For the project repository, the default address is [h2ooooooo.github.io/dockline](https://h2ooooooo.github.io/dockline/).

GitHub supplies the site's base path through `actions/configure-pages`. The workflow passes it as `DOCKLINE_DOCS_BASE` and sets `DOCKLINE_GITHUB_PAGES=true`. Pages builds use explicit `.html` links for direct navigation on static hosting. Ordinary local development and preview use `/` and clean URLs.

See GitHub's [publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the one-time repository setting.
