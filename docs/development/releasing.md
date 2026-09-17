# Updates, releases and documentation

[GitHub repository](https://github.com/h2ooooooo/dockline) · [Public documentation](https://h2ooooooo.github.io/dockline/) · [Workflow runs](https://github.com/h2ooooooo/dockline/actions)

The repository contains six public package workspaces, including the new SSH client. The SSH client must receive its first explicit publication before registry installation is available. The CLI is one of those workspaces, not a separate Git repository. Library and CLI documentation share this VitePress site. Each page links to its Markdown source on GitHub, and the package reference links to each package's source and npm page.

## Choose what to update

| Change | Required release |
| --- | --- |
| Only files in docs/ | Build the docs, commit and push main; Pages deploys the site. No npm version bump is needed. |
| Package README or homepage metadata | Publish a new version of each affected package to update its npm presentation. A GitHub push alone does not update npm. |
| Package behavior, declarations or dependencies | Choose a semantic version, validate affected consumers and publish the affected packages. |
| All packages together | Version and validate the workspaces together, then publish them sequentially in dependency order. |

Published name/version pairs are immutable. A message saying a version is already published is not a reason to retry or unpublish it. Check the registry and resume only the unfinished packages. The website tracks main; installed packages track the versions selected by each consumer's lockfile.

## Prepare all workspace versions together

Run this from the repository root when intentionally preparing the next patch release of every package:

```sh
npm version patch --workspaces --include-workspace-root --no-git-tag-version
```

This increments each selected manifest's version without making a Git commit or tag. Packages already on different versions keep their separate version lines. Use an explicit version instead of patch only when intentionally aligning every package; use minor for compatible features or major for breaking changes.

Review dependencies, devDependencies and peerDependencies between workspaces. Raise a minimum version when a dependent needs a newly introduced API or fix; do not assume the version command updates every compatibility range. Preserve optional protocol-client peers. The separate private docs project does not need the library release number. Refresh and review the lockfile after any range edits:

```sh
npm install --package-lock-only --ignore-scripts
git diff -- package.json package-lock.json packages
```

For a single-package release, replace --workspaces and --include-workspace-root with `--workspace=<package-name>`. Include dependents when their required ranges or public contracts change. Update examples and any version-specific documentation.

## Validate before publishing

Use the Node/npm versions declared in package.json. Run these commands one at a time and stop on any failure:

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run check:repository
npm run check:packages
npm run check:consumer
npm run audit:production
npm run docs:install
npm run audit:docs
npm run docs:build
npm publish --workspaces --access public --dry-run
```

Review the dry-run package inventories. Root and docs projects are private. Production and docs audits are separate from development test-server findings; see [dependencies](/development/dependencies). Packed-consumer checks validate installed artifacts rather than relying on workspace hoisting.

## Publish all packages in one sequence

Sign in to npm with the jalsoedesign account or an account authorized for its scope. A matching personal scope does not require a separate organization:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

The following PowerShell block publishes every package in dependency order and stops immediately on failure. It performs real public releases; run it only after reviewing the versions and validation results. Complete any npm authentication prompts.

```powershell
$releasePackages = @(
    '@jalsoedesign/dockline-abstract',
    '@jalsoedesign/dockline-ftp-client',
    '@jalsoedesign/dockline-sftp-client',
    '@jalsoedesign/dockline-ssh-client',
    '@jalsoedesign/dockline-core',
    '@jalsoedesign/dockline-cli'
)

foreach ($packageName in $releasePackages) {
    npm publish --workspace=$packageName --access public

    if ($LASTEXITCODE -ne 0) {
        throw "Publishing stopped at $packageName. Check npm before resuming."
    }
}
```

This is a sequence, not an atomic transaction: earlier packages remain published if a later package fails. Check each package with `npm view <package-name> versions --json` and remove successful entries from the list before resuming. Do not rerun the full list after a partial release. Use npm publish `--workspace=<package-name>` --access public to release just one package.

After publishing, verify npm metadata and installation:

```sh
npm view @jalsoedesign/dockline-cli version repository homepage
npm install -g @jalsoedesign/dockline-cli @jalsoedesign/dockline-ftp-client @jalsoedesign/dockline-sftp-client
dockline --help
```

## Commit and push source or documentation updates

Review the diff and explicitly stage the intended files. Commit and push are separate actions from the build, version and npm publishing commands:

```sh
git status --short
git diff
git diff --cached
git commit -m "Update packages and documentation"
git push origin main
```

Stage the reviewed paths with `git add <paths>` before the commit. Use a descriptive message matching the actual change. For a package release, commit the validated manifests, lockfile, source and docs before publishing so package metadata can identify the release commit. A push to main runs CI and the Pages workflow; it does not publish npm packages. Wait for successful workflow runs before treating the online docs as updated.

## GitHub and Pages setup

The canonical repository is [h2ooooooo/dockline](https://github.com/h2ooooooo/dockline). For a new remote, create it without generated files and configure origin with git remote add origin https://github.com/h2ooooooo/dockline.git. If a separately initialized history already exists, inspect it before deciding whether to preserve or replace it. A normal rejected push does not justify an unconditional force push.

1. Open [Settings → Pages](https://github.com/h2ooooooo/dockline/settings/pages).
2. Choose GitHub Actions under Build and deployment.
3. Push main, or run Deploy VitePress docs to Pages from the Actions tab.
4. Wait for deployment and open [the documentation](https://h2ooooooo.github.io/dockline/).

On the repository's Code page, the right-hand About section has a gear button. Set Website to https://h2ooooooo.github.io/dockline/. The website field is not in the main Settings page. No personal access token is required for the prepared Pages workflow.

## Update an installed application

In an application's own repository, npm update refreshes installed packages within its declared ranges and updates its lockfile. Select only the packages that application uses. Install an explicit new version to adopt a new minimum or major version, then run the application's tests before committing its manifest and lockfile. Do not install optional clients that the application does not use.

References: [npm workspace versioning](https://docs.npmjs.com/cli/v11/commands/npm-version/), [publishing scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
