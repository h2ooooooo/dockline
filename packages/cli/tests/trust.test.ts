import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, unlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PassThrough, Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {HostTrustError, type SftpHostKeyChallenge, type SftpTransferConfig} from '@jalsoedesign/dockline-core';
import {KnownHostsStore} from '@jalsoedesign/dockline-sftp-client';
import {createCliTrust} from '../src/trust.js';

const connection: SftpTransferConfig = {protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'};
let directory: string;
let filename: string;

function challenge(suffix = 'first'): SftpHostKeyChallenge {
    const algorithm = Buffer.from('ssh-ed25519');
    const length = Buffer.alloc(4);

    length.writeUInt32BE(algorithm.length);

    const publicKey = Buffer.concat([length, algorithm, Buffer.from(suffix)]);

    return {
        host: 'fixture.invalid',
        port: 22,
        keyType: 'ssh-ed25519',
        publicKey,
        fingerprint: `SHA256:${createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, '')}`,
        changed: false,
        abortSignal: new AbortController().signal,
    };
}

function terminal(tty = true, signal?: AbortSignal) {
    const stdin = Object.assign(new PassThrough(), {isTTY: tty});
    let output = '';
    let markPrompt!: () => void;
    const prompted = new Promise<void>(resolve => {
        markPrompt = resolve;
    });
    const stderr = Object.assign(new Writable({
        write(chunk, _encoding, callback) {
            output += chunk.toString();

            if (output.includes('remember this host:')) {
                markPrompt();
            }

            callback();
        },
    }), {isTTY: tty});

    return {
        stdin,
        stderr,
        signal,
        prompted,
        output: () => output,
    };
}

beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dockline-cli-trust-'));
    filename = path.join(directory, 'known-hosts.json');
});

afterEach(async () => {
    const resolved = path.resolve(directory);

    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('dockline-cli-trust-')
    ) {
        throw new Error('Refusing to remove an unexpected test directory');
    }

    await rm(resolved, {recursive: true, force: true});
});

describe('CLI SFTP trust', () => {
    it('uses an explicit fingerprint without creating a trust file or prompting', async () => {
        const key = challenge();
        const context = terminal(false);
        const hooks = createCliTrust(connection, {fingerprint: key.fingerprint}, context, true);

        expect(hooks.requireTrustPolicy).toBe(true);
        expect(await hooks.hasTrustPolicy!(key)).toBe(true);
        await expect(hooks.hasTrustPolicy!(challenge('different'))).rejects.toBeInstanceOf(HostTrustError);
        await expect(hooks.hasTrustPolicy!({...key, host: 'another.invalid'})).rejects.toBeInstanceOf(HostTrustError);
        await expect(hooks.hasTrustPolicy!({...key, port: 2222})).rejects.toBeInstanceOf(HostTrustError);
        expect(context.output()).toBe('');
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
    });

    it('recalls exact known host identity in JSON and noninteractive modes', async () => {
        const key = challenge();
        const store = await KnownHostsStore.open({file: filename});

        await store.recordAccepted(key, {approved: true, previousFingerprint: null});

        const context = terminal(false);
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, true);

        expect(await hooks.hasTrustPolicy!(key)).toBe(true);
        expect(await hooks.acceptTrustPolicy!(key)).toBe(true);
        expect(context.output()).toBe('');
    });

    it.each([
        {json: true, tty: true},
        {json: false, tty: false},
    ])('refuses unknown trust without prompting for $json JSON / $tty TTY', async ({json, tty}) => {
        const context = terminal(tty);
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, json);

        expect(await hooks.hasTrustPolicy!(challenge())).toBe(false);
        await expect(hooks.acceptTrustPolicy!(challenge())).rejects.toBeInstanceOf(HostTrustError);
        expect(context.output()).toBe('');
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
    });

    it('shows the fingerprint and remembers an unknown host only after explicit yes', async () => {
        const key = challenge();
        const context = terminal();
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);
        const approval = hooks.acceptTrustPolicy!(key);

        await context.prompted;
        expect(context.output()).toContain(key.fingerprint);
        context.stdin.write('yes\n');
        expect(await approval).toBe(true);

        const reopened = await KnownHostsStore.open({file: filename});

        expect(await reopened.matches(key)).toBe(true);
        expect(await hooks.hasTrustPolicy!(key)).toBe(true);
    });

    it.each(['', 'y', 'no'])('does not remember a host after the answer %s', async answer => {
        const context = terminal();
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);
        const approval = hooks.acceptTrustPolicy!(challenge());

        await context.prompted;
        context.stdin.write(answer + '\n');
        expect(await approval).toBe(false);
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
    });

    it('rejects a changed remembered key without offering to overwrite it', async () => {
        const original = challenge();
        const changed = challenge('changed');
        const store = await KnownHostsStore.open({file: filename});

        await store.recordAccepted(original, {approved: true, previousFingerprint: null});

        const context = terminal();
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);

        await expect(hooks.hasTrustPolicy!(changed)).rejects.toBeInstanceOf(HostTrustError);
        await expect(hooks.acceptTrustPolicy!(changed)).rejects.toBeInstanceOf(HostTrustError);
        expect(await store.matches(original)).toBe(true);
        expect(context.output()).toBe('');
    });

    it('rejects stale approval if another writer records a conflicting key during the prompt', async () => {
        const key = challenge();
        const other = challenge('other');
        const context = terminal();
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);
        const approval = hooks.acceptTrustPolicy!(key);

        await context.prompted;

        const writer = await KnownHostsStore.open({file: filename});

        await writer.recordAccepted(other, {approved: true, previousFingerprint: null});
        context.stdin.write('yes\n');
        await expect(approval).rejects.toBeInstanceOf(HostTrustError);
        expect(await writer.matches(other)).toBe(true);
    });

    it('cancels a pending interactive prompt without remembering the key', async () => {
        const controller = new AbortController();
        const context = terminal(true, controller.signal);
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);
        const approval = Promise.resolve(hooks.acceptTrustPolicy!(challenge()));
        const rejected = expect(approval).rejects.toBeInstanceOf(Error);

        await context.prompted;
        controller.abort();
        await rejected;
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
        expect(context.stdin.listenerCount('keypress')).toBe(0);
        expect(context.stdin.isPaused()).toBe(true);
    });

    it('ends a prompt when terminal input closes instead of waiting forever', async () => {
        const controller = new AbortController();
        const context = terminal(true, controller.signal);
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);
        const approval = Promise.resolve(hooks.acceptTrustPolicy!(challenge()));
        const outcome = approval.then(value => value ? 'accepted' : 'refused', () => 'rejected');

        await context.prompted;
        context.stdin.end();

        const result = await Promise.race([outcome, delay(150).then(() => 'pending')]);

        controller.abort();
        await outcome;
        expect(['refused', 'rejected']).toContain(result);
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
    });

    it('does not persist trust when context cancellation occurs while the store lock is held', async () => {
        const controller = new AbortController();
        const context = terminal(true, controller.signal);
        const hooks = createCliTrust(connection, {knownHostsFile: filename}, context, false);

        await writeFile(filename + '.lock', 'another writer');

        const approval = Promise.resolve(hooks.acceptTrustPolicy!(challenge()));
        const outcome = approval.then(value => value ? 'accepted' : 'refused', () => 'rejected');

        await context.prompted;
        context.stdin.write('yes\n');
        await delay(40);
        controller.abort();
        await delay(40);
        await unlink(filename + '.lock');

        expect(await outcome).toBe('rejected');
        await expect(readFile(filename)).rejects.toMatchObject({code: 'ENOENT'});
    });
});
