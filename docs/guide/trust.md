# Host trust

Authentication proves your account to the server; host verification decides which server receives that authentication. Dockline lets your application provide a remembered decision, a CLI or UI approval flow, or a fixed verifier.

## Explicit policy hooks

For low-level `SftpConnector`, `requireTrustPolicy` is opt-in. When set to `true`, both `hasTrustPolicy` and `acceptTrustPolicy` must be functions, or connection fails before network access. The lookup runs before the acceptance hook; returning `true` accepts an unchanged exact challenge without prompting. A changed key observed by the same connector still requires explicit acceptance. Otherwise the acceptance hook must explicitly return `true`. Neither hook creates a terminal prompt automatically.

```ts
import {SftpConnector} from '@dockline/sftp-client';

const connector = new SftpConnector({
    host: 'sftp.example.com',
    port: 22,
    username: 'deploy',
    password: suppliedPassword,
    initialPath: '/releases',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => challenge.fingerprint === verifiedFingerprint,
    acceptTrustPolicy: () => false,
});
```

Obtain `verifiedFingerprint` through a trusted channel. A challenge contains `host`, `port`, `keyType`, a SHA-256 `fingerprint`, the SSH wire-format public-key buffer, optional `previousFingerprint`, `changed`, and an `abortSignal`. Compare host and port as well as the key when sharing a trust lookup between destinations. The fingerprint uses OpenSSH-style `SHA256:` encoding without base64 padding. Public keys are identity material, not private authentication keys.

Without either policy hook or `hostVerifier`, the low-level connector retains the underlying transport's permissive host-key behavior. Applications that require verified SSH identity must configure a policy or verifier. The high-level configuration is documented separately under [configuration](/guide/configuration).

A supplied `hostVerifier` runs before policy lookup/acceptance and must approve first. When policy hooks are also supplied, those must subsequently approve the challenge too. It accepts either `(publicKey) => boolean | Promise<boolean>` or the transport-compatible `(publicKey, verify) => void` callback form. Select one verification approach deliberately. `requireTrustPolicy: true` still validates both policy callbacks even if a verifier is also supplied.

Hook failures reject trust, and callback work is covered by the connection deadline and abort signal. A cancelled or expired attempt cannot authenticate from a late approval. The connector tracks a changed fingerprint within its lifetime; persistent changed-key detection belongs to a store such as the one below.

## FTPS certificate trust

FTP TLS uses Node certificate verification and `FtpConnectorConfig.secureOptions`. Supply a trusted private CA when needed. A failed certificate is reported as `TlsTrustError`, which also extends `HostTrustError`. SSH policy callbacks apply to SFTP; they do not approve TLS certificates.

## Managed known-hosts storage

`KnownHostsStore` is an optional, explicitly selected JSON store. It does not discover or edit `~/.ssh/known_hosts`, another client's trust files or the Windows registry. Opening a missing store does not create it until an approval is recorded.

```ts
import {KnownHostsStore, SftpConnector} from '@dockline/sftp-client';

const store = await KnownHostsStore.open({file: selectedTrustFile});
const connector = new SftpConnector({
    ...connection,
    ...store.trustPolicy(async (challenge) => {
        return applicationUi.confirmHostKey({
            host: challenge.host,
            port: challenge.port,
            keyType: challenge.keyType,
            fingerprint: challenge.fingerprint,
            previousFingerprint: challenge.previousFingerprint,
            changed: challenge.changed,
            abortSignal: challenge.abortSignal,
        });
    }),
});
```

`trustPolicy()` supplies `requireTrustPolicy: true`, a bound exact-match lookup, and an acceptance callback. Only your callback returning `true` records approval. New keys and changed keys are reviewed explicitly. A changed-key challenge includes the previously persisted fingerprint even after restarting your application. The store keeps one approved key per normalized host and port; replacing that key requires fresh approval.

Applications that need their own workflow can use the lower-level methods:

```ts
const inspection = await store.inspect(challenge);
// inspection.status: 'unknown' | 'match' | 'changed'

if (await applicationUi.approve(challenge, inspection)) {
    await store.recordAccepted(challenge, {
        approved: true,
        previousFingerprint: inspection.previousFingerprint,
    });
}
```

`previousFingerprint` is mandatory and is `null` for an unknown host. The store compares it again after acquiring its write lock. A competing approval of a different key produces `KnownHostsConflictError`; inspect and ask again instead of overwriting the new trust state. Concurrent approvals of separate hosts merge, and accepting the same key twice is harmless.

The version 1 document contains only host, port, key type, public key and SHA-256 fingerprint. `await store.entries()` returns public-key records for review or explicit export. To import a reviewed exported record, reconstruct its public-key buffer, inspect the destination store, and use the same approval workflow. External trust importers can supply an exact-match callback separately; approved trust is never silently copied into this managed store.

Store reads are bounded to 1 MiB and reject malformed, duplicate or incompatible entries. Writes use an exclusive lock and a flushed temporary file followed by atomic replacement. New files request mode `0600`, and new parent directories request `0700`; Windows access is governed by inherited ACLs, so select an application-owned directory. `lockTimeoutMs` defaults to 5000. On Windows, a temporary `EPERM` while acquiring the exclusive lock waits within that same budget; a persistent permission failure retains its original error. Other access failures remain immediate. Abandoned locks are never stolen automatically: verify that no writer is active before removing a stale `.lock` file. All cooperating writers must use this store API. The versioned JSON is the interchange format; OpenSSH hashed-host and certificate formats are not parsed.

`requireTrustPolicy` remains opt-in for compatibility and still requires both lookup and acceptance hooks. Configure it, or an explicit `hostVerifier`, whenever your application requires verification. The connector never decides whether an unfamiliar key should be trusted.
