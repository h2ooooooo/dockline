import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OperationAbortedError} from '@dockline/abstract';
import {KnownHostsStore, KnownHostsConflictError} from '../src/KnownHostsStore.js';
import type {SftpHostKeyChallenge} from '../src/SftpConnector.js';

let directory: string;
let filename: string;
const challenge = (host = 'host.invalid', suffix = 'first'): SftpHostKeyChallenge => {
    const algorithm = Buffer.from('ssh-ed25519');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(algorithm.length);

    const publicKey = Buffer.concat([length, algorithm, Buffer.from(suffix)]);

    return {
        host,
        port: 22,
        keyType: 'ssh-ed25519',
        publicKey,
        fingerprint: `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
        changed: false,
        abortSignal: new AbortController().signal,
    };
};

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dockline-managed-trust-'));
    filename = join(directory, 'trust.json');
});

afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
});

describe('managed known-hosts trust', () => {
    it('requires explicit approval and recognizes exact identity after reopening', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const key = challenge('HOST.invalid');

        expect(await store.inspect(key)).toEqual({status: 'unknown', previousFingerprint: null});
        await expect(store.recordAccepted(key, {approved: false} as never)).rejects.toThrow('explicit approval');
        await store.recordAccepted(key, {approved: true, previousFingerprint: null});

        const reopened = await KnownHostsStore.open({file: filename});

        expect(await reopened.matches(challenge())).toBe(true);
        expect(await reopened.matches({...key, port: 23})).toBe(false);
        expect(await reopened.matches(challenge('another.invalid'))).toBe(false);
        expect((await reopened.entries())[0].publicKey).toBe(key.publicKey.toString('base64'));
    });

    it('asks for unknown and changed keys with persisted previous-key metadata', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const oldKey = challenge();
        const newKey = challenge('host.invalid', 'changed');
        const policy = store.trustPolicy(async (review) => review.changed === false);

        expect(await policy.acceptTrustPolicy(oldKey)).toBe(true);
        expect(await policy.hasTrustPolicy(newKey)).toBe(false);
        expect(await policy.acceptTrustPolicy(newKey)).toBe(false);
        expect(await store.matches(oldKey)).toBe(true);

        const replacement = store.trustPolicy(async (review) => {
            expect(review.changed).toBe(true);
            expect(review.previousFingerprint).toBe(oldKey.fingerprint);

            return true;
        });

        expect(await replacement.acceptTrustPolicy(newKey)).toBe(true);
        expect(await store.matches(oldKey)).toBe(false);
        expect(await store.matches(newKey)).toBe(true);
    });

    it('merges concurrent approved hosts without lost writes', async () => {
        const stores = await Promise.all(Array.from({length: 8}, () => KnownHostsStore.open({file: filename})));

        const results = await Promise.allSettled(stores.map((store, index) => store.recordAccepted(challenge(`host${index}.invalid`), {
            approved: true,
            previousFingerprint: null,
        })));

        expect(results.every(result => result.status === 'fulfilled')).toBe(true);
        expect(await stores[0].entries()).toHaveLength(8);
        expect(JSON.parse(await readFile(filename, 'utf8')).entries).toHaveLength(8);
    });

    it('rejects stale approval when another writer accepted a conflicting key', async () => {
        const first = await KnownHostsStore.open({file: filename});
        const second = await KnownHostsStore.open({file: filename});

        await first.recordAccepted(challenge(), {approved: true, previousFingerprint: null});
        await expect(second.recordAccepted(challenge('host.invalid', 'second'), {
            approved: true,
            previousFingerprint: null,
        })).rejects.toBeInstanceOf(KnownHostsConflictError);
        expect(await first.matches(challenge())).toBe(true);
    });

    it('does not trust a key changed by a callback or write after cancellation', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const key = challenge();
        const policy = store.trustPolicy((review) => {
            review.publicKey.fill(0);

            return true;
        });

        expect(await policy.acceptTrustPolicy(key)).toBe(true);
        expect(await store.matches(key)).toBe(true);

        const controller = new AbortController();

        controller.abort();
        await expect(store.recordAccepted({...challenge('cancelled.invalid'), abortSignal: controller.signal}, {
            approved: true,
            previousFingerprint: null,
        })).rejects.toBeInstanceOf(OperationAbortedError);
        expect(await store.entries()).toHaveLength(1);
    });

    it('rejects a misleading displayed fingerprint before approval can be persisted', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const misleading = {...challenge(), fingerprint: 'SHA256:incorrect'};

        await expect(store.inspect(misleading)).rejects.toThrow('metadata');
        await expect(store.recordAccepted(misleading, {approved: true, previousFingerprint: null}))
            .rejects.toThrow('metadata');
        expect(await store.entries()).toEqual([]);
    });

    it('does not steal abandoned locks and rejects malformed or oversized files', async () => {
        const store = await KnownHostsStore.open({file: filename, lockTimeoutMs: 0});

        await writeFile(`${filename}.lock`, 'another writer');
        await expect(store.recordAccepted(challenge(), {
            approved: true,
            previousFingerprint: null,
        })).rejects.toMatchObject({code: 'TRUST_STORE_LOCKED'});
        expect(await readFile(`${filename}.lock`, 'utf8')).toBe('another writer');

        await writeFile(filename, '{"version":2,"entries":[]}');
        await expect(KnownHostsStore.open({file: filename})).rejects.toThrow('Unsupported');
        await writeFile(filename, Buffer.alloc(1024 * 1024 + 1));
        await expect(KnownHostsStore.open({file: filename})).rejects.toThrow('1 MiB');
    });
});
