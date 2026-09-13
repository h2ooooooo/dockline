import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, open, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {KnownHostsStore} from '../src/KnownHostsStore.js';
import {OperationAbortedError} from '@dockline/abstract';
import type {SftpHostKeyChallenge} from '../src/SftpConnector.js';

const {openFile} = vi.hoisted(() => ({openFile: vi.fn()}));

vi.mock('node:fs/promises', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();

    return {...actual, open: openFile.mockImplementation(actual.open)};
});

let directory: string;
let filename: string;

function challenge(signal = new AbortController().signal): SftpHostKeyChallenge {
    const algorithm = Buffer.from('ssh-ed25519');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(algorithm.length);

    const publicKey = Buffer.concat([length, algorithm, Buffer.alloc(32, 23)]);

    return {
        host: 'fixture.invalid',
        port: 22,
        keyType: 'ssh-ed25519',
        publicKey,
        fingerprint: `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
        changed: false,
        abortSignal: signal,
    };
}

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dockline-lock-regression-'));
    filename = join(directory, 'trust.json');

    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

    openFile.mockReset().mockImplementation(actual.open);
});

afterEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

    openFile.mockReset().mockImplementation(actual.open);
    await rm(directory, {recursive: true, force: true});
});

describe.skipIf(process.platform !== 'win32')('Windows exclusive trust-lock contention', () => {
    it('retries transient EPERM within the existing deadline and records one approval', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const permission = Object.assign(new Error('Temporary Windows lock contention'), {code: 'EPERM'});

        openFile.mockRejectedValueOnce(permission);
        await store.recordAccepted(challenge(), {approved: true, previousFingerprint: null});
        expect(await store.entries()).toHaveLength(1);
        expect(vi.mocked(open).mock.calls.filter(([file]) => file === `${filename}.lock`)).toHaveLength(2);
    });

    it('preserves a persistent permission error at the bounded deadline without altering a lock', async () => {
        const store = await KnownHostsStore.open({file: filename, lockTimeoutMs: 30});
        const permission = Object.assign(new Error('Permanent permission denial'), {code: 'EPERM'});

        await writeFile(`${filename}.lock`, 'another writer');
        openFile.mockRejectedValue(permission);
        await expect(store.recordAccepted(challenge(), {approved: true, previousFingerprint: null}))
            .rejects.toBe(permission);
        expect(openFile.mock.calls.length).toBeGreaterThan(1);
        expect(await readFile(`${filename}.lock`, 'utf8')).toBe('another writer');
        expect(await store.entries()).toEqual([]);
    });

    it('cancels the contention wait without stealing or creating a lock', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const controller = new AbortController();
        const permission = Object.assign(new Error('Temporary Windows lock contention'), {code: 'EPERM'});

        openFile.mockImplementation(async () => {
            controller.abort();

            throw permission;
        });
        await expect(store.recordAccepted(challenge(controller.signal), {approved: true, previousFingerprint: null}))
            .rejects.toBeInstanceOf(OperationAbortedError);
        expect(await store.entries()).toEqual([]);
        await expect(readFile(`${filename}.lock`)).rejects.toMatchObject({code: 'ENOENT'});
    });

    it('keeps other permission failures immediate', async () => {
        const store = await KnownHostsStore.open({file: filename});
        const permission = Object.assign(new Error('Access denied'), {code: 'EACCES'});

        openFile.mockRejectedValue(permission);
        await expect(store.recordAccepted(challenge(), {approved: true, previousFingerprint: null}))
            .rejects.toBe(permission);
        expect(openFile).toHaveBeenCalledOnce();
    });
});
