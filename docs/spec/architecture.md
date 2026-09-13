# Architecture and behavior specification

Dockline offers one transfer API over independently usable protocol clients. It owns network sessions and transfer mechanics. Applications own configuration sources, user interaction, credential persistence, deployment policy and recovery decisions.

## Components and dependencies

```text
Application configuration and credential/trust callbacks
                         |
                   @dockline/core
             relative paths, local file helpers
                         |
             selected installed client only
                    /           \
   @dockline/ftp-client         @dockline/sftp-client
          FtpConnector          SftpConnector
               |                    |
           basic-ftp           ssh2-sftp-client
               |                    |
       FTP / explicit             SSH / SFTP
        or implicit TLS

Core and both clients use @dockline/abstract:
contracts, errors, retries, progress, budgets, publication,
checksums, traversal, capabilities and session pools.
```

| Source | Responsibility |
| --- | --- |
| `packages/cli/src/` | Terminal commands, YAML/environment loading, output/exit policy and application-owned interactive host trust. |
| `packages/core/src/` | SDK path validation, client selection, lifecycle scopes and local upload/download helpers. |
| `packages/abstract/src/` | Transport-independent adapter/configuration contracts, option resolution, errors, observation, transfer tools, capabilities and pools. |
| `packages/ftp-client/src/` | FTP/FTPS operations, TLS, common-config factory, filename encoding and advertised feature/hash negotiation. |
| `packages/sftp-client/src/` | SFTP operations, common-config factory, SSH authentication, application-owned host trust and managed known-hosts persistence. |
| `packages/*/tests/` | Package regressions and disposable local protocol endpoints. |
| `scripts/` | Shared build, style and isolated package/consumer validation. |
| `docs/` | Independently installed VitePress documentation. |

The root is a private npm workspace. Core depends only on abstract; clients are optional peers. Each client depends on abstract and its own transport stack, with no dependency on core or the other client. Shared types keep core's declarations usable without installing either protocol implementation. See [package layout](/guide/packages).

The optional CLI is an application layer over core. It owns command flags, YAML loading, configuration-relative local paths, absolute remote-path translation, structured output, signal handling and interactive host decisions. It does not change core's relative-path or transfer semantics. See [CLI configuration](/cli/configuration).

## Client selection and failure

Importing core does not load both clients. Synchronous construction validates configuration and resolves only the selected installed client. FTP, explicit FTPS and implicit FTPS select the FTP package; SFTP selects the SFTP package. No network connection opens during construction.

An absent selected client causes `MissingClientPackageError` with the protocol, required package and suggested installation command. Core never installs a dependency, silently chooses another protocol or treats a broken present client as merely absent. `new Dockline`, `Dockline.create` and `createConnector` remain synchronous; `connect` and `withConnection` retain their promise-based authentication flow.

Applications can bypass core and construct a direct client with its established low-level configuration or its exported common-config factory. Abstract provides contracts for independent adapters, but core's protocol union currently selects only its two supported client packages; there is no arbitrary provider registry.


## Connection ownership

Creating a `Dockline` instance validates configuration without immediately connecting. `connect` opens a session, and operations can use the adapters' initial connection behavior. A scoped `withConnection` call connects before invoking its callback and disconnects afterward, including failed work. If operation and cleanup both fail, both errors are retained.

The application must consume or close resources before leaving a scoped SDK callback. A `ConnectorPool` explicitly tracks leased operations and returned streams/iterators until completion or disposal. Metadata and listings consume the same connection quota as transfers. Creating a pool does not grant permission to exceed a server's connection ceiling through unrelated connections.

Idle keepalive is optional. It must not compete with active FTP control/data operations. Observer exceptions cannot change a confirmed operation into a failed/retryable one. Shutdown invalidates new work and reports bounded failure when a transport cannot close; an unresolved transport is not silently treated as released capacity.

## Authentication and trust

Credential providers receive the actual connection attempt, protocol family, host/port, purpose and cancellation signal. Password, private-key and agent credentials are explicit modes. A selected agent is not permission to fall back to another credential source. Keyboard-interactive responses come from the application; a string is valid only for a single prompt.

Trust policies can look up a remembered host key and request acceptance through either a CLI or UI. When `requireTrustPolicy` is true, both `hasTrustPolicy` and `acceptTrustPolicy` are required. This flag is opt-in. Applications requiring verification must supply a trust policy or host verifier; the low-level permissive default is not described as verified trust.

Managed known hosts records only explicit approval against the previously inspected state. Changed keys and competing updates require fresh approval. The store contains public host identity data, not passwords or private authentication keys. Credential encryption and application account storage are outside the SDK.

## Paths and local files

SDK operation arguments are relative to the configured remote root, use forward slashes and reject traversal segments, absolute/drive-prefixed paths, controls, backslashes and invalid Unicode. Root-capable operations allow `.`. Direct adapters keep their lower-level path semantics.

This validation is lexical. Remote symlinks, server-side aliases, permissions and concurrent changes can invalidate assumed containment. A remote root is not a security sandbox. Applications performing destructive synchronization need their own verified path and state rules.

Local paths use Node's filesystem conventions. Uploads require a regular local file. The supplied fresh-stream factory enables eligible retries, but callers must keep source bytes stable until completion. The default upload directly replaces the remote target. Fail-on-existing upload requests checked publication and rejects unsupported FTP policy before reading/uploading the file.

Downloads stage in an exclusively created sibling directory, enforce a byte limit only when explicitly configured and compare transferred length with available initial size. Download size is unlimited by default. The final local destination is published only after complete consumption. Default no-replace publication requires hard-link support; explicit replacement uses rename. Cleanup owns only the created staging data. A remote file changing during download is not a transactional snapshot, and a cleanup failure after publication must not be interpreted as proof that the destination is absent.

File size has no implicit byte ceiling. Connection/connector `maxBytes` supplies an optional per-transfer default, and a call can override it. Omission or `undefined` inherits; `Infinity` explicitly removes an inherited cap. Zero permits only empty content. Finite limits must be non-negative safe integers and are validated before transfer I/O. Raw reads/writes and SDK uploads/downloads enforce limits on streamed bytes, independently of progress size hints. Streamed hashes and copies follow the same rules; publication verification can override its inherited limit with `verify.maxBytes`.

## Completion, retries and cancellation

An FTP transfer is complete only after data transfer and the final control-channel acknowledgement. SFTP stream completion must reflect the full operation. Returning a readable is not transfer completion; it must be consumed or destroyed. Progress counts bytes at the stream boundary and does not promise durable server storage or final local destination publication.

Default options are a 30-second per-attempt deadline, three extra eligible transient attempts and automatic reconnect disabled. Per-call values override defaults. Authentication, trust, permission, unsupported operations and explicit cancellation are not generic retry candidates. An error's classification cannot make a consumed stream or uncertain mutation safe to replay.

Cancellation stops waiting or transfer work where supported and interrupts resource ownership. Some dependency callbacks can settle late. Late creation/results are cleaned up; they cannot resume a cancelled request or silently release a still-open transport slot.

## Publication, copy and inventory

Remote publication validates the requested policy before creating an exclusively owned sibling staging directory. It uploads one owned file, optionally verifies a digest, then performs a final explicit rename. Rename acknowledgement loss is uncertain and is never automatically replayed. Recovery state identifies destination, temporary ownership, phase, outcome and cleanup status.

Portable FTP cannot guarantee fail-on-existing or atomic rename. SFTP replacement can use the POSIX rename extension; unsupported combinations fail rather than weaken the requested behavior. Atomicity is limited to an individual supported rename and does not create a multi-file transaction or remote lock.

Copy defaults to a local spool with no byte limit and uses the same connection for reading and publishing. An explicit connector or call `maxBytes` limits the spool and streamed checksum reads. It uses local disk and transfers bytes twice, without hidden extra sessions. Server-native copy is unsupported. Streamed checksum fallback requires explicit permission and only occurs when server hashing is unsupported, not after arbitrary failure.

Walking uses explicit depth/entry budgets and prunes rejected directories. Examined entries count even when filtered. The separate result identifies complete traversal, budget exhaustion, cancellation, consumer exit or failure. A dependency may buffer an individual directory response before these budgets apply. Capability reports separate adapter support, server advertisements and unknown information; an advertisement does not establish path permissions.

## Compatibility boundaries

The adapters implement the storage-adapter contract used by `@flystorage/file-storage`; applications may choose to wrap them. The ordinary SDK does not instantiate that wrapper. Unsupported visibility, MIME guessing and public/temporary URL methods remain explicit interface rejections.

The optional `@dockline/cli` package supplies terminal commands and YAML loading. There is no UI, external site-configuration importer, deployment journal, automatic synchronization, server-native copy, resumable transfer or proxy/jump-host configuration. See [dependencies](../development/dependencies.md) for upstream error/normalization boundaries and [testing](../development/testing.md) for how these guarantees are verified.
