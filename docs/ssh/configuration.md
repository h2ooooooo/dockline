# SSH connection options and services

Import `SshClient` from `@jalsoedesign/dockline-ssh-client` for commands. It is independent of the main FTP/FTPS/SFTP transfer factory. Start with the [complete SSH program](/ssh/quick-start); use the [shared Portline bridge](/guide/saved-profiles) when the input is a saved application profile.

## Connection options

The constructor requires resolved `host`, `port` and `username`. `withConnection(overrides, callback)` also accepts connection overrides. Changing host, port or username clears inherited credentials, key/agent selection and host fingerprint before applying the explicit overrides.

| Option | Contract |
| --- | --- |
| `password` | Explicit account password. |
| `privateKeyPath`, `passphrase` | Supported private-key file and optional unlocking passphrase; contents are normalized in memory. |
| `agent` | Explicit selected SSH agent. Agent forwarding is not enabled. |
| `keyboardInteractive` | Set `true` to enable keyboard-interactive authentication. Answers come from services. |
| `hostFingerprint` | Independently verified SHA256 host pin; a mismatch rejects the server. |
| `readyTimeout` | Handshake/authentication deadline in milliseconds; default `60000`, positive safe integer through `2147483647`. |
| `sudo` | Optional password-prompt/environment policy for scoped sudo commands. |

In-memory `privateKey` contents are supported by the direct SFTP client; this SSH command API currently requires `privateKeyPath`. SSH commands use a POSIX remote shell. TCP forwarding, SSH hop execution, persistent interactive terminal sessions and remote Windows shell syntax are not implemented by this API.

## Runtime services

The constructor's second argument accepts optional services. These are live process options and do not belong in serialized profile metadata.

| Service | Contract |
| --- | --- |
| `trust(host, port, fingerprint)` | Async explicit host-identity decision; defaults to rejection. A configured fingerprint pin takes precedence. The SSH callback receives the fingerprint, not raw public-key bytes. |
| `keyboardInteractive` | String for one prompt, or callback receiving the complete server challenge and returning ordered string answers. |
| `ask(question)` | Input/password answer for sudo and the fallback per-prompt interactive flow; no terminal UI is bundled. |
| `signal` | Cancel authentication/session operations; grouped challenges expose the signal so the caller can cancel prompt UI. The caller owns its controller. |
| `log(message)` | Receive streamed command output; silent by default. |
| `directory` | Base directory for host-side file helper paths; defaults to the working directory. |

Without a pin or a trust callback accepting the observed identity, authentication fails. The caller owns credential persistence, host approval UI and durable trust storage. The fallback `ask` question has no signal field, so its UI lifecycle remains caller-owned. The exported `SshServices.resolve` member describes the internal resolved service shape; it is not a constructor-injected service.

## Preserve grouped interactive challenges

This contextual helper accepts resolved connection details with verified host identity and an answer handler. It returns the command result and prints nothing. The handler receives the original `name`, `instructions`, `language`, complete ordered `prompts` with echo flags, and `abortSignal`. A callback is invoked once for each server challenge, including multi-prompt challenges.

::: code-group

```ts [TypeScript]
import {SshClient, type ResolvedSsh, type SshServices} from '@jalsoedesign/dockline-ssh-client';

async function runWithChallenges(
    connection: ResolvedSsh,
    answer: NonNullable<SshServices['keyboardInteractive']>,
) {
    const client = new SshClient({
        ...connection,
        keyboardInteractive: true,
        readyTimeout: 30000,
    }, {keyboardInteractive: answer});

    return client.withConnection(session => session.exec('whoami'));
}
```

```js [JavaScript]
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

async function runWithChallenges(
    connection,
    answer,
) {
    const client = new SshClient({
        ...connection,
        keyboardInteractive: true,
        readyTimeout: 30000,
    }, {keyboardInteractive: answer});

    return client.withConnection(session => session.exec('whoami'));
}
```

```js [MJS]
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

async function runWithChallenges(
    connection,
    answer,
) {
    const client = new SshClient({
        ...connection,
        keyboardInteractive: true,
        readyTimeout: 30000,
    }, {keyboardInteractive: answer});

    return client.withConnection(session => session.exec('whoami'));
}
```

```js [CommonJS]
const {SshClient} = require('@jalsoedesign/dockline-ssh-client');

async function runWithChallenges(
    connection,
    answer,
) {
    const client = new SshClient({
        ...connection,
        keyboardInteractive: true,
        readyTimeout: 30000,
    }, {keyboardInteractive: answer});

    return client.withConnection(session => session.exec('whoami'));
}
```

:::

Return one string for every prompt, preserving order. Missing, extra or non-string answers fail authentication. A string handler may answer exactly one prompt and is refused for grouped multi-prompt challenges. When no grouped handler is supplied, `ask` remains the per-prompt fallback. The same grouped service is preserved by the SSH session's independently opened SFTP file helpers.

`readyTimeout` bounds authentication; command and file helpers have their own `timeout` options with a one-hour default. A caller signal can bound the entire direct session. The shared bridge additionally exposes `timeoutMs` for the complete `withSsh` scope, including profile/credential preparation. Commands are never automatically retried. Cleanup closes the connection in `finally`; cancellation cannot prove that a remote process stopped.
