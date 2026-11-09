# Connect saved application profiles

Dockline executes network operations. Native readers interpret FileZilla, WinSCP, PuTTY/KiTTY, OpenSSH, JetBrains and HeidiSQL settings into Portline definitions. The optional `@jalsoedesign/portline-dockline` package converts those definitions into Dockline configuration and scoped sessions. Native parsing, application-specific credential decoding and native trust-store import stay with each reader.

`Native reader → Portline connection definition → optional shared bridge → selected Dockline client`

The bridge lives in the [Portline repository](https://github.com/h2ooooooo/portline/tree/main/packages/portline-dockline), outside Dockline. Neither Dockline core nor its clients import application readers or Portline. Continue using [direct Dockline configuration](/api/quick-start) when saved application settings are not the input.

## Install the integration and selected clients

Install the native reader selected from the [ecosystem directory](https://h2ooooooo.github.io/portline/ecosystem), plus the shared integration and the required client:

| Operation | Install beside the selected reader |
| --- | --- |
| FTP or FTPS files | `npm install @jalsoedesign/portline-dockline@rc @jalsoedesign/dockline-ftp-client@rc` |
| SFTP files | `npm install @jalsoedesign/portline-dockline@rc @jalsoedesign/dockline-sftp-client@rc` |
| SSH commands | `npm install @jalsoedesign/portline-dockline@rc @jalsoedesign/dockline-ssh-client@rc` |

Reading profiles does not require these execution packages. The bridge requires Dockline core and abstract contracts, but its FTP, SFTP and SSH clients are optional peers. Installing a handler never supplies missing credentials or approves a host.

## Use one file API for every source

This contextual helper accepts an opened Portline source, an exact saved-profile path and, for SSH/SFTP, an independently verified host fingerprint. Source construction belongs to the reader's documentation. The source's credential provider is used by default; a separate provider can be supplied through `createDocklineBridge({source, credentials})`. The helper returns path strings and prints nothing.

::: code-group

```ts [TypeScript]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';
import type {CredentialProvider, ProfileSource} from '@jalsoedesign/portline-abstract';

async function listSavedFiles(
    source: ProfileSource & Partial<CredentialProvider>,
    selectedPath: string,
    verifiedFingerprint?: string,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withFiles(selectedPath, async remote => {
        const entries = [];

        for await (const entry of remote.list('.')) {
            entries.push(entry.path);
        }

        return entries;
    }, {hostFingerprint: verifiedFingerprint});
}
```

```js [JavaScript]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';


async function listSavedFiles(
    source,
    selectedPath,
    verifiedFingerprint,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withFiles(selectedPath, async remote => {
        const entries = [];

        for await (const entry of remote.list('.')) {
            entries.push(entry.path);
        }

        return entries;
    }, {hostFingerprint: verifiedFingerprint});
}
```

```js [MJS]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';


async function listSavedFiles(
    source,
    selectedPath,
    verifiedFingerprint,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withFiles(selectedPath, async remote => {
        const entries = [];

        for await (const entry of remote.list('.')) {
            entries.push(entry.path);
        }

        return entries;
    }, {hostFingerprint: verifiedFingerprint});
}
```

```js [CommonJS]
const {createDocklineBridge} = require('@jalsoedesign/portline-dockline');

async function listSavedFiles(
    source,
    selectedPath,
    verifiedFingerprint,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withFiles(selectedPath, async remote => {
        const entries = [];

        for await (const entry of remote.list('.')) {
            entries.push(entry.path);
        }

        return entries;
    }, {hostFingerprint: verifiedFingerprint});
}
```

:::

The selected FTP definition uses the FTP handler; an SSH/SFTP definition uses SFTP. The fingerprint applies to SSH/SFTP, while FTP/FTPS follows its explicit saved TLS policy and certificate verification. For FTP-only usage, omit `hostFingerprint`. Pass `connectionId` when several definitions support the requested operation.

## Execute an explicit SSH operation

This helper returns `{code, stdout, stderr}` and prints nothing. It accepts an SSH or SFTP definition. The server may allow SFTP while refusing command execution. The bridge never invents an SSH endpoint from an FTP profile.

::: code-group

```ts [TypeScript]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';
import type {CredentialProvider, ProfileSource} from '@jalsoedesign/portline-abstract';

async function runSavedCommand(
    source: ProfileSource & Partial<CredentialProvider>,
    selectedPath: string,
    verifiedFingerprint: string,
    connectionId?: string,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withSsh(selectedPath, session => session.exec('whoami'), {
        connectionId,
        hostFingerprint: verifiedFingerprint,
        readyTimeout: 30000,
        timeoutMs: 60000,
    });
}
```

```js [JavaScript]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';


async function runSavedCommand(
    source,
    selectedPath,
    verifiedFingerprint,
    connectionId,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withSsh(selectedPath, session => session.exec('whoami'), {
        connectionId,
        hostFingerprint: verifiedFingerprint,
        readyTimeout: 30000,
        timeoutMs: 60000,
    });
}
```

```js [MJS]
import {createDocklineBridge} from '@jalsoedesign/portline-dockline';


async function runSavedCommand(
    source,
    selectedPath,
    verifiedFingerprint,
    connectionId,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withSsh(selectedPath, session => session.exec('whoami'), {
        connectionId,
        hostFingerprint: verifiedFingerprint,
        readyTimeout: 30000,
        timeoutMs: 60000,
    });
}
```

```js [CommonJS]
const {createDocklineBridge} = require('@jalsoedesign/portline-dockline');

async function runSavedCommand(
    source,
    selectedPath,
    verifiedFingerprint,
    connectionId,
) {
    const bridge = createDocklineBridge({source});

    return bridge.withSsh(selectedPath, session => session.exec('whoami'), {
        connectionId,
        hostFingerprint: verifiedFingerprint,
        readyTimeout: 30000,
        timeoutMs: 60000,
    });
}
```

:::

`withFiles` owns a Dockline file session; `withSsh` owns an SSH command session. Consume streams and iterators before leaving the callback. A database definition is not a file session; selecting a separate saved SSH definition does not open a database connection.

## Metadata, credentials and trust

Profiles carry credential references and supported saved settings, not secret values or runtime callbacks. Explicit execution/configuration preparation resolves credentials only for the selected definition. Runtime password, key, agent and interactive options can select authentication deliberately. Configuration returned by `toConfig` or `toSshConfig` can contain secrets and must not be logged as profile metadata.

SSH/SFTP requires an explicit fingerprint, supported saved fingerprint pins or an endpoint-bound `trust(challenge)` decision. Native trust-file readers may supply that provider. The shared bridge does not persist approvals, copy stored secrets or inherit a native application's weaker host-verification policy. Its required verification is stricter than the optional policy flag of the direct low-level SFTP adapter.

## Explicit failures and supported scope

The bridge reports `ProfileExecutionError` from `@jalsoedesign/portline-dockline`:

| Code | Meaning |
| --- | --- |
| `MISSING_HANDLER` | Install the named optional Dockline client using the included command. |
| `PROFILE_NOT_FOUND` | The exact source path did not select a profile. |
| `CONNECTION_SELECTION_REQUIRED` | Several definitions match; supply `connectionId`. |
| `MISSING_CREDENTIAL` | Supply a usable explicit credential/provider or required interactive handler. |
| `MISSING_TRUST` | Supply host verification before SSH/SFTP execution. |
| `UNSUPPORTED_PROFILE` | Native settings, protocol or requested execution semantics cannot be honored. |
| `INVALID_PROFILE` | Required endpoint metadata is invalid. |

Installed handlers that fail to load retain their original errors. Transport failures remain Dockline errors. The bridge never installs packages or downgrades protocols automatically. Ambiguous FTP TLS requires a deliberate choice; required TLS cannot be downgraded. Unsupported native options and SSH `via` hops are refused rather than ignored. Several saved private-key alternatives require an explicit runtime authentication selection. See [Portline's execution contract](https://h2ooooooo.github.io/portline/integration/execution) for supported conversion details.

Direct `Dockline.create/connect/withConnection` supports FTP/FTPS/SFTP configuration only. Installing the SSH package does not extend that transfer factory with `protocol: 'ssh'`; use `SshClient` directly or the shared bridge's `withSsh`. The [Dockline CLI](/cli/) continues to use YAML/environment configuration and does not read native application profiles.

## Default interactive host approval

When neither a fingerprint nor a trust callback is configured, the shared bridge asks for SSH/SFTP host approval if both standard input and standard error are interactive terminals. It displays the endpoint and server fingerprint; only an explicit `yes` accepts a new host. Matching approvals are reused for that bridge instance. A changed approved key requires the distinct response `replace`. Approval is session-only and is never written to disk. Explicit pins and configured providers retain priority, and a pin mismatch never falls back to a prompt.

Redirected input, pipelines and unattended jobs do not prompt: configure a fingerprint or trust provider. Browser/server applications supply their own approval callback. The downloadable programs use explicit pins to remain reproducible in unattended checks; interactive callers may omit them.
