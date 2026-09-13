import {open, lstat, mkdir, rename, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ConnectorError, HostTrustError, OperationAbortedError} from '@jalsoedesign/dockline-abstract';
import type {SftpHostKeyChallenge, SftpTrustPolicy} from './SftpConnector.js';

const MAX_FILE_BYTES = 1024 * 1024;

export interface KnownHostsStoreOptions {
    file: string;
    /** Competing writers wait this long; abandoned locks are never silently stolen. */
    lockTimeoutMs?: number;
}

export interface KnownHostEntry {
    readonly host: string;
    readonly port: number;
    readonly keyType: string;
    readonly publicKey: string;
    readonly fingerprint: string;
}

export interface KnownHostInspection {
    readonly status: 'unknown' | 'match' | 'changed';
    readonly previousFingerprint: string | null;
}

export interface KnownHostApproval {
    approved: true;
    /** Value returned by inspect() before asking for approval; null means unknown. */
    previousFingerprint: string | null;
}

export class KnownHostsConflictError extends HostTrustError {
    public constructor() {
        super('Known-hosts trust changed while approval was pending; inspect and approve the new state again');
    }
}

function aborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new OperationAbortedError('Known-hosts operation was cancelled');
    }
}

function identity(host: string, port: number): string {
    if (
        typeof host !== 'string' ||
        host.length === 0 ||
        host.length > 1024 ||
        /\s/u.test(host) ||
        [...host].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
    ) {
        throw new ConnectorError('Invalid known-hosts host or port');
    }

    return JSON.stringify([host.toLowerCase(), port]);
}

function entryFor(challenge: Pick<SftpHostKeyChallenge, 'host' | 'port' | 'publicKey'>): KnownHostEntry {
    identity(challenge.host, challenge.port);

    const key = challenge.publicKey;

    if (!Buffer.isBuffer(key) || key.length < 5 || key.length > 65536) {
        throw new ConnectorError('Invalid known-hosts public key');
    }

    const length = key.readUInt32BE(0);
    const keyType = key.subarray(4, 4 + length).toString('ascii');

    if (
        length < 1 ||
        length > 255 ||
        length >= key.length - 4 ||
        !key.subarray(4, 4 + length).every((byte) => byte < 128) ||
        !/^[A-Za-z0-9@._+-]+$/.test(keyType)
    ) {
        throw new ConnectorError('Invalid known-hosts key algorithm');
    }

    return {
        host: challenge.host.toLowerCase(),
        port: challenge.port,
        keyType,
        publicKey: key.toString('base64'),
        fingerprint: `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`,
    };
}

function challengeEntry(challenge: SftpHostKeyChallenge): KnownHostEntry {
    const entry = entryFor(challenge);

    if (entry.fingerprint !== challenge.fingerprint || entry.keyType !== challenge.keyType) {
        throw new HostTrustError('Host-key challenge metadata does not match its public key');
    }

    return entry;
}

function hasCode(error: unknown, code: string): boolean {
    return error instanceof Error && 'code' in error && error.code === code;
}

/** Explicitly selected, versioned JSON trust store. Never discovers or edits external client trust files. */
export class KnownHostsStore {
    private constructor(private readonly file: string, private readonly lockTimeoutMs: number) {}

    public static async open(options: KnownHostsStoreOptions): Promise<KnownHostsStore> {
        if (typeof options.file !== 'string' || options.file.length === 0) {
            throw new ConnectorError('A known-hosts store filename is required');
        }

        const timeout = options.lockTimeoutMs ?? 5000;

        if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 300000) {
            throw new ConnectorError('Known-hosts lockTimeoutMs must be between 0 and 300000');
        }

        const store = new KnownHostsStore(resolve(options.file), timeout);

        await store.readEntries();

        return store;
    }

    private async readEntries(): Promise<Map<string, KnownHostEntry>> {
        const entries = new Map<string, KnownHostEntry>();

        try {
            const info = await lstat(this.file);

            if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
                throw new ConnectorError('Known-hosts store must be a regular file no larger than 1 MiB');
            }
        } catch (error) {
            if (hasCode(error, 'ENOENT')) {
                return entries;
            }

            throw error;
        }

        const file = await open(this.file, 'r');
        let document: unknown;

        try {
            const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
            let length = 0;

            while (length <= MAX_FILE_BYTES) {
                const read = await file.read(bytes, length, bytes.length - length, null);

                if (read.bytesRead === 0) {
                    break;
                }

                length += read.bytesRead;
            }

            if (length > MAX_FILE_BYTES) {
                throw new ConnectorError('Known-hosts store must be no larger than 1 MiB');
            }

            document = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length)));
        } catch {
            throw new ConnectorError('Invalid known-hosts store document');
        } finally {
            await file.close();
        }

        if (
            !document ||
            typeof document !== 'object' ||
            !('version' in document) ||
            document.version !== 1 ||
            !('entries' in document) ||
            !Array.isArray(document.entries) ||
            Object.keys(document).length !== 2
        ) {
            throw new ConnectorError('Unsupported or invalid known-hosts store document');
        }

        for (const value of document.entries) {
            if (
                !value ||
                typeof value !== 'object' ||
                Object.keys(value).length !== 5 ||
                typeof value.publicKey !== 'string' ||
                typeof value.keyType !== 'string' ||
                typeof value.fingerprint !== 'string'
            ) {
                throw new ConnectorError('Invalid known-hosts store entry');
            }

            const entry = entryFor({...value, publicKey: Buffer.from(value.publicKey, 'base64')});
            const id = identity(entry.host, entry.port);

            if (
                entry.publicKey !== value.publicKey ||
                entry.keyType !== value.keyType ||
                entry.fingerprint !== value.fingerprint ||
                entries.has(id)
            ) {
                throw new ConnectorError('Invalid or duplicate known-hosts store entry');
            }

            entries.set(id, entry);
        }

        return entries;
    }

    public async inspect(challenge: SftpHostKeyChallenge): Promise<KnownHostInspection> {
        aborted(challenge.abortSignal);

        const candidate = challengeEntry(challenge);
        const entries = await this.readEntries();
        const previous = entries.get(identity(candidate.host, candidate.port));

        aborted(challenge.abortSignal);

        return {
            status: !previous ? 'unknown' : previous.publicKey === candidate.publicKey ? 'match' : 'changed',
            previousFingerprint: previous?.fingerprint ?? null,
        };
    }

    public readonly matches: SftpTrustPolicy = async (challenge) => (await this.inspect(challenge)).status === 'match';

    public readonly hasTrustPolicy = this.matches;

    /** Public-key data only; useful for explicit export/review. */
    public async entries(): Promise<readonly KnownHostEntry[]> {
        return [...(await this.readEntries()).values()].map((entry) => Object.freeze({...entry}));
    }

    public async recordAccepted(challenge: SftpHostKeyChallenge, approval: KnownHostApproval): Promise<void> {
        if (
            approval?.approved !== true ||
            (approval.previousFingerprint !== null &&
                typeof approval.previousFingerprint !== 'string')
        ) {
            throw new HostTrustError('Recording trust requires explicit approval and the previously inspected fingerprint');
        }

        aborted(challenge.abortSignal);

        const candidate = challengeEntry(challenge);

        await mkdir(dirname(this.file), {recursive: true, mode: 0o700});

        const lockName = `${this.file}.lock`;
        const deadline = performance.now() + this.lockTimeoutMs;
        let lock: Awaited<ReturnType<typeof open>>;

        for (;;) {
            aborted(challenge.abortSignal);

            try {
                lock = await open(lockName, 'wx', 0o600);
                break;
            } catch (error) {
                const exists = hasCode(error, 'EEXIST');
                const windowsContention = process.platform === 'win32' && hasCode(error, 'EPERM');

                if (!exists && !windowsContention) {
                    throw error;
                }

                if (performance.now() >= deadline) {
                    if (!exists) {
                        throw error;
                    }

                    throw new ConnectorError('Known-hosts store is locked by another writer', undefined, 'TRUST_STORE_LOCKED');
                }

                try {
                    await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, {
                        signal: challenge.abortSignal,
                    });
                } catch {
                    aborted(challenge.abortSignal);
                }
            }
        }

        const temporary = `${this.file}.${randomUUID()}.tmp`;

        try {
            aborted(challenge.abortSignal);

            const entries = await this.readEntries();
            const id = identity(candidate.host, candidate.port);
            const previous = entries.get(id);

            if (previous?.publicKey === candidate.publicKey) {
                return;
            }

            if ((previous?.fingerprint ?? null) !== approval.previousFingerprint) {
                throw new KnownHostsConflictError();
            }

            entries.set(id, candidate);

            const contents = `${JSON.stringify({version: 1, entries: [...entries.values()]}, null, 4)}\n`;

            if (Buffer.byteLength(contents) > MAX_FILE_BYTES) {
                throw new ConnectorError('Known-hosts store would exceed 1 MiB');
            }

            const output = await open(temporary, 'wx', 0o600);

            try {
                await output.writeFile(contents, 'utf8');
                await output.sync();
            } finally {
                await output.close();
            }

            aborted(challenge.abortSignal);
            await rename(temporary, this.file);
        } finally {
            await unlink(temporary).catch((error: unknown) => {
                if (!hasCode(error, 'ENOENT')) {
                    throw error;
                }
            }).finally(async () => {
                await lock.close();
                await unlink(lockName);
            });
        }
    }

    /** Adds persisted changed-key metadata before asking the application's CLI or UI. */
    public trustPolicy(approve: SftpTrustPolicy): {
        requireTrustPolicy: true;
        hasTrustPolicy: SftpTrustPolicy;
        acceptTrustPolicy: SftpTrustPolicy;
    } {
        return {
            requireTrustPolicy: true,
            hasTrustPolicy: this.matches,
            acceptTrustPolicy: async (challenge) => {
                const inspection = await this.inspect(challenge);
                const acceptedChallenge = {...challenge, publicKey: Buffer.from(challenge.publicKey)};
                const reviewed = Object.freeze({
                    ...acceptedChallenge,
                    publicKey: Buffer.from(acceptedChallenge.publicKey),
                    previousFingerprint: inspection.previousFingerprint ?? challenge.previousFingerprint,
                    changed: inspection.status === 'changed' || challenge.changed,
                });

                if (await approve(reviewed) !== true) {
                    return false;
                }

                await this.recordAccepted(acceptedChallenge, {
                    approved: true,
                    previousFingerprint: inspection.previousFingerprint,
                });

                return true;
            },
        };
    }
}
