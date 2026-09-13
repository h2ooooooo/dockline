# Connection pools

## One connection budget

```ts
import {ConnectorPool} from '@dockline/abstract';
import {SftpConnector, type SftpConnectorConfig} from '@dockline/sftp-client';

// Supply ordinary connection settings and explicit application trust hooks.
const connection: SftpConnectorConfig = verifiedConnectionOptions;

const pool = new ConnectorPool({
    create: () => new SftpConnector(connection),
    maxConnections: 3,
    serverMaxConnections: 3,
    idleTimeoutMs: 30_000,
});

try {
    await Promise.all(paths.map(path => pool.withConnection(async connector => {
        await connector.write(path, () => openSource(path), {abortSignal});
    }, {abortSignal})));
} finally {
    await pool.close();
}
```

The pool creates independent authenticated sessions, not parallel commands on one FTP session. The default limit is three. A positive `serverMaxConnections` lowers that limit; zero means no additional server limit. Every lease counts, including folder listing, stat, checksums, read consumption and uploads. Connections created outside this pool cannot be counted by it; use one shared pool for a shared server quota.

The creation callback receives an `abortSignal` for cancellation-aware setup. Do not pre-create shared connector instances: each creation must return an independent connector owned by this pool. All trust/provider configuration applies to every new session. Repeated sessions can therefore require repeated application prompts unless the application's trust or credential provider remembers decisions.

Acquisition uses FIFO queuing, supports cancellation and defaults to a 30-second deadline. A cancelled slow creation remains counted until its connector can be closed; the pool does not open an extra session merely to hide a slow factory. `stats` reports the effective limit, owned connections, active/creating sessions and queued requests.

## Streams, iterators and explicit leases

`withConnection` tracks operations, returned readable streams, asynchronous listing iterators and a walk's entries. A returned read retains its lease until fully consumed or destroyed. A returned iterator retains it until completion or explicit `return()`. Consume or close each resource: leaving a stream idle also leaves that server connection occupied.

For explicit ownership, use `const lease = await pool.acquire(options)`, work through `lease.connector`, then `await lease.release()`. Release waits for tracked work; calls through a released proxy fail. Do not return the connector itself, save unbound methods for later, or use its internals outside the lease.

Idle sessions are closed after 30 seconds by default; zero disables idle eviction. Broken sessions are disposed rather than returned to the pool. `close()` rejects queued acquisitions and waits for active leases. `close({force: true})` invalidates leases and interrupts their streams/operations. Shutdown has a 30-second default deadline, overridable through `timeoutMs`; a connector that refuses to close yields a timeout rather than a false cleanup guarantee.
