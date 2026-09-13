import {ResourceLimitError} from '@dockline/abstract';
import {FtpSrv} from 'ftp-srv';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {describe, test, expect, afterEach} from 'vitest';
import {FtpConnector} from '../src/FtpConnector.js';
import {AuthError} from '../src/errors.js';

// Public fixtures only: every server binds an OS-assigned loopback port and a new temporary root.
const user = 'local-fixture';
const password = 'public-test-password';
const require = createRequire(import.meta.url);
const FileSystem = require('ftp-srv/src/fs.js');
const cleanup: Array<() => Promise<unknown>> = [];
const log = {
    child() {
        return this;
    },
    info() {},
    debug() {},
    warn() {},
    error() {},
    trace() {},
    fatal() {},
};

afterEach(async () => {
    for (const release of cleanup.splice(0).reverse()) {
        await release();
    }
});

async function fixture(secure: false | true | 'implicit' = false) {
    const root = await mkdtemp(join(tmpdir(), 'dockline-ftp-integration-'));

    cleanup.push(async () => {
        const resolved = resolve(root);

        if (!resolved.startsWith(`${resolve(tmpdir())}${sep}`) || !resolved.includes('dockline-ftp-integration-')) {
            throw new Error('Refusing to remove an unexpected test directory');
        }

        await rm(resolved, {recursive: true, force: true});
    });
    await mkdir(join(root, 'deployment'));

    const bytes = Buffer.alloc(2 * 1024 * 1024, 42);

    await writeFile(join(root, 'deployment', 'large.bin'), bytes);

    const cert = await readFile(new URL('./fixtures/localhost-test-cert.pem', import.meta.url), 'utf8');
    const key = await readFile(new URL('./fixtures/localhost-test-key.pem', import.meta.url), 'utf8');
    const server = new FtpSrv({
        url: `${secure === 'implicit' ? 'ftps' : 'ftp'}://127.0.0.1:0`,
        pasv_url: '127.0.0.1',
        pasv_min: 0,
        pasv_max: 0,
        anonymous: false,
        log,
        ...(secure ? {tls: {key, cert}} : {}),
    });

    server.on('login', ({username, password: supplied, connection}: any, accept: any, reject: any) => {
        if (username !== user || supplied !== password) {
            reject(new Error('Fixture credentials rejected'));

            return;
        }

        const fs = new FileSystem(connection, {root});
        const originalMkdir = fs.mkdir.bind(fs);

        fs.mkdir = (path: string) => path.includes('denied') ? Promise.reject(new Error('Permission denied')) : originalMkdir(path);
        accept({fs});
    });
    server.on('client-error', () => {});
    await server.listen();
    cleanup.push(async () => {
        await server.close();
    });

    const port = (server as any).server.address().port;
    const config = {
        host: '127.0.0.1',
        port,
        user,
        password,
        secure,
        initialPath: '/deployment',
        passive: true,
        timeoutMs: 5000,
        maxTransientRetries: 0,
    };
    const connector = new FtpConnector({
        ...config,
        ...(secure ? {secureOptions: {ca: cert, rejectUnauthorized: true}} : {}),
    });

    cleanup.push(() => connector.disconnect());

    return {
        connector,
        config,
        cert,
        root,
        bytes,
    };
}

async function drain(stream: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream as Readable) {
        chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

describe('isolated real FTP integration', () => {
    test('publishes verified content, copies through one session and computes an opted-in stream checksum', async () => {
        const {connector, root} = await fixture();
        const bytes = Buffer.from('verified publication payload');
        const expectedDigest = createHash('sha256').update(bytes).digest('hex');
        const published = await connector.publishFile('release.bin', Readable.from([bytes]), {
            overwrite: 'replace',
            verify: {expectedDigest, maxBytes: 1024},
        });

        expect(published).toMatchObject({atomic: false, verified: true, cleanup: 'done'});
        expect(await readFile(join(root, 'deployment/release.bin'))).toEqual(bytes);

        const copied = await connector.copyFileWithStrategy('release.bin', 'copied.bin', {
            overwrite: 'replace',
            maxBytes: 1024,
        });

        expect(copied.strategy).toBe('client-streamed');
        expect(copied.bytesCopied).toBe(bytes.length);
        expect(await readFile(join(root, 'deployment/copied.bin'))).toEqual(bytes);
        await expect(connector.checksum('copied.bin', {
            strategy: 'stream',
            algo: 'sha256',
            encoding: 'base64',
        })).resolves.toBe(Buffer.from(expectedDigest, 'hex').toString('base64'));

        const traversal = connector.walk('', {maxEntries: 10});
        const entries: string[] = [];

        for await (const entry of traversal.entries) {
            entries.push(entry.path);
        }

        expect(entries).toContain('copied.bin');
        expect(entries.some(path => path.includes('.dockline-upload-'))).toBe(false);
        await expect(traversal.result).resolves.toMatchObject({complete: true});
    });

    test('transfers large streams and handles directory metadata, moves, deletes and explicit reuse', async () => {
        const {connector, root, bytes} = await fixture();

        const downloaded = await drain(await connector.read('large.bin', {}));

        expect(downloaded.equals(bytes)).toBe(true);
        await connector.createDirectory('nested', {});
        await connector.write('nested/upload.bin', Readable.from([bytes]), {});

        const uploaded = await readFile(join(root, 'deployment/nested/upload.bin'));

        expect(uploaded.equals(bytes)).toBe(true);
        expect(await connector.directoryExists('/', {})).toBe(true);
        expect(await connector.directoryExists('.', {})).toBe(true);
        expect(await connector.directoryExists('nested/', {})).toBe(true);
        expect(await connector.fileExists('missing.bin', {})).toBe(false);
        expect(await connector.fileSize('nested/upload.bin', {})).toBe(bytes.length);
        expect(await connector.lastModified('large.bin', {})).toBeGreaterThan(0);

        const paths: string[] = [];

        for await (const entry of connector.list('', {deep: true})) {
            paths.push(entry.path);
        }

        expect(paths).toContain('nested/upload.bin');
        await connector.moveFile('nested/upload.bin', 'nested/moved.bin', {});
        expect(await connector.fileExists('nested/upload.bin', {})).toBe(false);
        await connector.deleteFile('nested/moved.bin', {});
        await connector.deleteDirectory('nested', {});
        expect(await connector.directoryExists('nested/', {})).toBe(false);
        await connector.disconnect();
        expect(await connector.fileExists('large.bin', {})).toBe(true);
    }, 30000);

    test('restores the real working directory after a partially denied mkdir', async () => {
        const {connector, root} = await fixture();

        await expect(connector.createDirectory('nested/denied', {})).rejects.toThrow();
        await connector.write('after-failure.txt', Readable.from(['correct directory']), {});
        expect(await readFile(join(root, 'deployment/after-failure.txt'), 'utf8')).toBe('correct directory');
    });

    test('classifies rejected credentials through the shared AuthError', async () => {
        const {config} = await fixture();
        const bad = new FtpConnector({...config, password: 'wrong-public-fixture-password'});

        cleanup.push(() => bad.disconnect());
        await expect(bad.connect()).rejects.toBeInstanceOf(AuthError);
    });

    for (const secure of [true, 'implicit'] as const) {
        test(`validates certificates and transfers with ${secure === true ? 'explicit' : 'implicit'} FTPS`, async () => {
            const {connector, config, root} = await fixture(secure);
            const untrusted = new FtpConnector(config);

            cleanup.push(() => untrusted.disconnect());
            await expect(untrusted.connect()).rejects.toThrow();
            await connector.write('encrypted.txt', Readable.from(['verified TLS']), {});
            expect((await drain(await connector.read('encrypted.txt', {}))).toString()).toBe('verified TLS');
            expect(await readFile(join(root, 'deployment/encrypted.txt'), 'utf8')).toBe('verified TLS');
        });
    }
});

describe('FTP opt-in byte limits', () => {
    test('inherits connector limits and accepts larger per-call limits or explicit unlimited reads', async () => {
        const {config, root} = await fixture();
        const connector = new FtpConnector({...config, maxBytes: 4, autoReconnect: true});

        cleanup.push(() => connector.disconnect());
        await writeFile(join(root, 'deployment', 'small.txt'), 'hello');
        await writeFile(join(root, 'deployment', 'empty.txt'), '');
        await expect(drain(await connector.read('small.txt', {}))).rejects.toBeInstanceOf(ResourceLimitError);
        await expect(drain(await connector.read('small.txt', {maxBytes: undefined})))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect((await drain(await connector.read('small.txt', {maxBytes: 5}))).toString()).toBe('hello');
        expect((await drain(await connector.read('small.txt', {maxBytes: Infinity}))).toString()).toBe('hello');
        expect(await drain(await connector.read('empty.txt', {maxBytes: 0}))).toHaveLength(0);
        await expect(drain(await connector.read('small.txt', {maxBytes: 0}))).rejects.toBeInstanceOf(ResourceLimitError);
        await expect(connector.checksumDetails('small.txt', {strategy: 'stream', maxBytes: undefined}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        await expect(connector.checksumDetails('small.txt', {strategy: 'stream', maxBytes: Infinity}))
            .resolves.toMatchObject({bytesRead: 5});
        await expect(connector.copyFileWithStrategy('small.txt', 'copy.txt', {overwrite: 'replace', maxBytes: undefined}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        await expect(connector.copyFileWithStrategy('small.txt', 'copy.txt', {overwrite: 'replace', maxBytes: Infinity}))
            .resolves.toMatchObject({bytesCopied: 5});
        expect(await connector.fileExists('small.txt', {})).toBe(true);
    });

    test('preserves typed upload limits without retrying and validates invalid caps before opening sources', async () => {
        const {config, root} = await fixture();
        const connector = new FtpConnector({
            ...config,
            maxBytes: 4,
            autoReconnect: true,
            maxTransientRetries: 3,
        });
        let opened = 0;
        const source = () => {
            opened++;

            return Readable.from(['hello']);
        };

        cleanup.push(() => connector.disconnect());
        await expect(connector.write('limited.txt', source, {})).rejects.toBeInstanceOf(ResourceLimitError);
        expect(opened).toBe(1);
        await expect(connector.write('invalid.txt', source, {maxBytes: null as never})).rejects.toBeInstanceOf(RangeError);
        expect(opened).toBe(1);
        await connector.write('unlimited.txt', source, {maxBytes: Infinity});
        expect((await readFile(join(root, 'deployment', 'unlimited.txt'))).toString()).toBe('hello');
        expect(() => new FtpConnector({...config, maxBytes: -1})).toThrow(RangeError);
    });
});
