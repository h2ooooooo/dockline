import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {NotSupportedError, PublicationError} from '@dockline/abstract';
import {SftpConnector} from '../src/SftpConnector.js';
import {createLocalSftp} from './local-sftp.js';

let server: Awaited<ReturnType<typeof createLocalSftp>>;
const instances: SftpConnector[] = [];
const adapter = () => {
    const connector = new SftpConnector({
        host: '127.0.0.1',
        port: server.port,
        username: 'fixture',
        password: 'fixture-password',
        initialPath: '',
        requireTrustPolicy: true,
        hasTrustPolicy: (challenge) => challenge.fingerprint === server.fingerprint,
        acceptTrustPolicy: () => false,
        timeoutMs: 3000,
        maxTransientRetries: 0,
    });

    instances.push(connector);

    return connector;
};

beforeAll(async () => {
    server = await createLocalSftp();
});
afterEach(async () => {
    await Promise.all(instances.splice(0).map((connector) => connector.disconnect()));
});
afterAll(async () => {
    await server.close();
});

describe('SFTP advanced transfer integration', () => {
    it('requires new directory ownership and never recursively removes a nonempty directory', async () => {
        const connector = adapter();

        await connector.createDirectoryExclusive('/owned');
        await expect(connector.createDirectoryExclusive('/owned')).rejects.toThrow('new directory');
        await connector.write('/owned/other.txt', Readable.from(['retain me']));
        await expect(connector.removeEmptyDirectory('/owned')).rejects.toThrow();
        expect(server.files.get('/owned/other.txt')?.toString()).toBe('retain me');
    });

    it('publishes a verified staged upload and preserves a preexisting destination', async () => {
        const connector = adapter();
        const content = Buffer.from('reviewed release');
        const expectedDigest = createHash('sha256').update(content).digest('hex');
        const result = await connector.publishFile('/published.txt', Readable.from([content]), {
            verify: {expectedDigest},
        });

        expect(result).toMatchObject({
            destination: '/published.txt',
            atomic: false,
            verified: true,
            cleanup: 'done',
        });
        expect(server.files.get('/published.txt')).toEqual(content);
        await expect(connector.publishFile('/published.txt', Readable.from(['replacement'])))
            .rejects.toBeInstanceOf(PublicationError);
        expect(server.files.get('/published.txt')).toEqual(content);
    });

    it('rejects unsupported atomic policies before upload and server-native checksums without silent fallback', async () => {
        const connector = adapter();
        const before = server.files.size;
        const connectionsBefore = server.observations.connections;

        await expect(connector.publishFile('/atomic.txt', Readable.from(['new']), {requireAtomicRename: true}))
            .rejects.toBeInstanceOf(NotSupportedError);
        expect(server.files.size).toBe(before);
        await expect(connector.copyFile('/epoch.txt', '/atomic-copy.txt', {requireAtomicRename: true}))
            .rejects.toBeInstanceOf(NotSupportedError);
        expect(server.observations.connections).toBe(connectionsBefore);
        await expect(connector.checksum('/epoch.txt')).rejects.toBeInstanceOf(NotSupportedError);

        const result = await connector.checksumDetails('/epoch.txt', {strategy: 'stream'});

        expect(result).toEqual({
            algorithm: 'sha256',
            strategy: 'stream',
            digest: createHash('sha256').update('epoch').digest('hex'),
            bytesRead: 5,
        });
    });

    it('copies through one bounded client stream strategy and reports partial walks honestly', async () => {
        const connector = adapter();
        const strategies: string[] = [];
        const connectionsBefore = server.observations.connections;

        const copied = await connector.copyFileWithStrategy('/epoch.txt', '/copied.txt', {
            onStrategy: (result) => strategies.push(result.strategy),
        });

        expect(strategies).toEqual(['client-streamed']);
        expect(copied).toMatchObject({strategy: 'client-streamed', bytesCopied: 5});
        expect(server.files.get('/copied.txt')?.toString()).toBe('epoch');
        expect(server.observations.connections - connectionsBefore).toBe(1);
        await expect(connector.copyFile('/epoch.txt', '/compat-copied.txt')).resolves.toBeUndefined();
        expect(server.files.get('/compat-copied.txt')?.toString()).toBe('epoch');

        const walk = connector.walk('/', {maxEntries: 1});
        const entries = [];

        for await (const entry of walk.entries) {
            entries.push(entry);
        }

        expect(entries).toHaveLength(1);
        expect(await walk.result).toMatchObject({complete: false, reason: 'max-entries'});
        expect((await connector.capabilities()).server.pathPermissions.state).toBe('unknown');
    });

    it('rejects filenames that cannot round trip as UTF-8 before touching a remote file', async () => {
        const connector = adapter();

        await expect(connector.write('/broken\ud800.txt', Readable.from(['content']))).rejects.toThrow('UTF-8');
        expect(server.files.has('/broken�.txt')).toBe(false);
    });
});
