import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {FtpSrv} from 'ftp-srv';
import {Dockline, relativeRemotePath} from '../src/Dockline.js';
import {PublicationError} from '@jalsoedesign/dockline-abstract';
import {createLocalSftp} from '../../sftp-client/tests/local-sftp.js';

let directory: string;
const cleanup: Array<() => Promise<unknown>> = [];
const logger = {
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

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dockline-sdk-protocols-'));
});

afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
        await close();
    }

    const target = resolve(directory);

    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !target.includes('dockline-sdk-protocols-')) {
        throw new Error('Unexpected SDK protocol test directory');
    }

    await rm(target, {recursive: true, force: true});
});

describe('SDK with real protocol sessions', () => {
    it('uploads and downloads exact bytes through one verified SFTP session and closes it', async () => {
        const endpoint = await createLocalSftp();
        const source = join(directory, 'source.bin');
        const destination = join(directory, 'download.bin');
        const bytes = Buffer.alloc(64 * 1024, 229);
        const states: string[] = [];

        cleanup.push(endpoint.close);
        await writeFile(source, bytes);
        await Dockline.withConnection({
            protocol: 'sftp',
            host: '127.0.0.1',
            port: endpoint.port,
            username: 'fixture',
            password: 'fixture-password',
            root: '/',
            timeoutMs: 5000,
            maxTransientRetries: 0,
            requireTrustPolicy: true,
            hasTrustPolicy: challenge => challenge.fingerprint === endpoint.fingerprint,
            acceptTrustPolicy: () => false,
            onConnectionState: event => states.push(event.state),
        }, async remote => {
            await remote.uploadFile(source, 'sdk-blå-日本.bin');
            expect(await remote.stat('sdk-blå-日本.bin')).toMatchObject({type: 'file', size: bytes.length});
            await remote.downloadFile('sdk-blå-日本.bin', destination);
        });

        expect(endpoint.files.get('/sdk-blå-日本.bin')).toEqual(bytes);
        expect(await readFile(destination)).toEqual(bytes);
        expect(endpoint.observations.connections).toBe(1);
        expect(endpoint.observations.passwords).toBe(1);
        expect(states).toEqual(['connecting', 'ready', 'disconnected']);
    });

    it('enforces SDK no-replace uploads through real SFTP publication', async () => {
        const endpoint = await createLocalSftp();
        const source = join(directory, 'source.bin');

        cleanup.push(endpoint.close);
        await writeFile(source, 'new bytes');
        endpoint.files.set('/protected.bin', Buffer.from('original'));
        await Dockline.withConnection({
            protocol: 'sftp',
            host: '127.0.0.1',
            port: endpoint.port,
            username: 'fixture',
            password: 'fixture-password',
            root: '/',
            timeoutMs: 5000,
            maxTransientRetries: 0,
            requireTrustPolicy: true,
            hasTrustPolicy: challenge => challenge.fingerprint === endpoint.fingerprint,
            acceptTrustPolicy: () => false,
        }, async remote => {
            await remote.uploadFile(source, 'new.bin', {overwrite: 'fail'});

            const failure = await remote.uploadFile(source, 'protected.bin', {overwrite: 'fail'}).catch(error => error);

            expect(failure).toBeInstanceOf(PublicationError);
            expect(failure.state).toMatchObject({phase: 'rename', outcome: 'uncertain', cleanup: 'retained'});
            expect(endpoint.files.get('/' + failure.state.temporaryPath)?.toString()).toBe('new bytes');
        });

        expect(endpoint.files.get('/new.bin')?.toString()).toBe('new bytes');
        expect(endpoint.files.get('/protected.bin')?.toString()).toBe('original');
    });

    it('maps ordinary FTP config and root before a file transfer, listing and download', async () => {
        const serverRoot = join(directory, 'remote');
        const source = join(directory, 'source.bin');
        const destination = join(directory, 'download.bin');
        const bytes = Buffer.from([
            0,
            255,
            128,
            42,
            100,
        ]);
        let authenticatedSessions = 0;

        await mkdir(join(serverRoot, 'deployment'), {recursive: true});
        await writeFile(source, bytes);

        const server = new FtpSrv({
            url: 'ftp://127.0.0.1:0',
            pasv_url: '127.0.0.1',
            pasv_min: 0,
            pasv_max: 0,
            anonymous: false,
            log: logger,
        });

        server.on('login', ({username, password}: any, accept: any, reject: any) => {
            if (username !== 'fixture' || password !== 'public-fixture-password') {
                reject(new Error('Fixture credentials rejected'));

                return;
            }

            authenticatedSessions++;
            accept({root: serverRoot});
        });
        server.on('client-error', () => {});
        await server.listen();
        cleanup.push(() => server.close());

        await Dockline.withConnection({
            protocol: 'ftp',
            host: '127.0.0.1',
            port: (server as any).server.address().port,
            username: 'fixture',
            password: 'public-fixture-password',
            root: '/deployment',
            timeoutMs: 5000,
            maxTransientRetries: 0,
        }, async remote => {
            await remote.uploadFile(source, 'sdk.bin');

            const listed: string[] = [];

            for await (const entry of remote.list()) {
                listed.push(relativeRemotePath(entry.path));
            }

            expect(listed).toContain('sdk.bin');
            await remote.downloadFile('sdk.bin', destination);
        });

        expect(authenticatedSessions).toBe(1);
        expect(await readFile(join(serverRoot, 'deployment', 'sdk.bin'))).toEqual(bytes);
        expect(await readFile(destination)).toEqual(bytes);
    });
});
