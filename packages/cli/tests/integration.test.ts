import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {FtpSrv} from 'ftp-srv';
import {KnownHostsStore} from '@dockline/sftp-client';
import {createLocalSftp} from '../../sftp-client/tests/local-sftp.js';

const executable = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const binary = Buffer.from([
    0,
    255,
    128,
    13,
    10,
    37,
    0,
    1,
]);
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

let directory: string;
let workingDirectory: string;
let serverRoot: string;
let ftp: FtpSrv;
let sftp: Awaited<ReturnType<typeof createLocalSftp>>;
let ftpConnections = 0;
let ftpPort: number;
let sequence = 0;

interface ProcessResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function start(arguments_: string[], runner = executable, ipc = false) {
    const child = spawn(process.execPath, [runner, ...arguments_], {
        cwd: workingDirectory,
        windowsHide: true,
        stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout!.on('data', chunk => {
        stdout += chunk;
    });
    child.stderr!.on('data', chunk => {
        stderr += chunk;
    });

    const result = new Promise<ProcessResult>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => resolve({code, stdout, stderr}));
    });

    return {child, result};
}

function invoke(arguments_: string[]): Promise<ProcessResult> {
    return start(arguments_).result;
}

function json(result: ProcessResult, code = 0) {
    expect(result.code, result.stdout + result.stderr).toBe(code);
    expect(result.stderr).toBe('');

    return JSON.parse(result.stdout);
}

async function configuration(protocol: 'ftp' | 'sftp', extra: Record<string, unknown> = {}) {
    const filename = path.join(directory, 'configuration files', `server-${sequence++}.yml`);
    const connection = protocol === 'ftp' ? {
        protocol,
        host: '127.0.0.1',
        port: ftpPort,
        username: 'fixture',
        password: 'fixture-password',
        root: '/configured',
        timeoutMs: 1500,
        maxTransientRetries: 0,
    } : {
        protocol,
        host: '127.0.0.1',
        port: sftp.port,
        username: 'fixture',
        password: 'fixture-password',
        root: '/',
        timeoutMs: 1500,
        maxTransientRetries: 0,
        trust: {fingerprint: sftp.fingerprint},
    };

    await writeFile(filename, JSON.stringify({version: 1, connection, ...extra}));

    return filename;
}

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'dockline-cli-protocols-'));
    workingDirectory = path.join(directory, 'caller with spaces');
    serverRoot = path.join(directory, 'ftp root');

    await mkdir(workingDirectory);
    await mkdir(path.join(directory, 'configuration files'));
    await mkdir(path.join(serverRoot, 'configured'), {recursive: true});

    ftp = new FtpSrv({
        url: 'ftp://127.0.0.1:0',
        pasv_url: '127.0.0.1',
        pasv_min: 0,
        pasv_max: 0,
        anonymous: false,
        log: logger,
    });

    ftp.on('login', ({username, password}: any, accept: any, reject: any) => {
        ftpConnections++;

        if (username !== 'fixture' || password !== 'fixture-password') {
            reject(new Error('Fixture credentials rejected'));

            return;
        }

        accept({root: serverRoot});
    });
    ftp.on('client-error', () => {});
    await ftp.listen();

    ftpPort = (ftp as any).server.address().port;
    sftp = await createLocalSftp();
}, 20000);

afterAll(async () => {
    await sftp?.close();
    await ftp?.close();

    if (!directory) {
        return;
    }

    const target = path.resolve(directory);

    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('dockline-cli-protocols-')) {
        throw new Error('Unexpected CLI test directory');
    }

    await rm(target, {recursive: true, force: true});
});

describe('built Dockline CLI over local protocols', () => {
    it.each(['ftp', 'sftp'] as const)('runs upload/list/download/remove with exact binary bytes over %s', async protocol => {
        const filename = await configuration(protocol);
        const source = `input ${protocol} $ & space.bin`;
        const remote = `uploaded ${protocol} $ & space.bin`;
        const destination = `downloads ${protocol}/nested/output & exact.bin`;
        const initialConnections = protocol === 'ftp' ? ftpConnections : sftp.observations.connections;

        await writeFile(path.join(workingDirectory, source), binary);

        expect(json(await invoke([
            'upload',
            '-c',
            filename,
            '-s',
            source,
            '-d',
            remote,
            '--json',
        ]))).toMatchObject({
            ok: true,
            command: 'upload',
        });

        const listed = json(await invoke([
            'list',
            '-c',
            filename,
            '-p',
            '.',
            '--json',
        ]));

        expect(listed).toMatchObject({ok: true, command: 'list'});
        expect(JSON.stringify(listed)).toContain(remote);
        expect(json(await invoke([
            'download',
            '-c',
            filename,
            '-s',
            remote,
            '-d',
            destination,
            '--json',
        ]))).toMatchObject({
            ok: true,
            command: 'download',
        });
        expect(await readFile(path.join(workingDirectory, destination))).toEqual(binary);
        expect(json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            remote,
            '--json',
        ]))).toMatchObject({
            ok: true,
            command: 'remove',
        });

        if (protocol === 'ftp') {
            expect(await readdir(path.join(serverRoot, 'configured'))).not.toContain(remote);
            expect(ftpConnections - initialConnections).toBe(4);
        } else {
            expect(sftp.files.has('/' + remote)).toBe(false);
            expect(sftp.observations.connections - initialConnections).toBe(4);
            expect(sftp.observations.openHandles).toBe(0);
        }
    }, 20000);

    it('resolves absolute remote paths from the server root and local destinations from the caller', async () => {
        const filename = await configuration('ftp');

        await writeFile(path.join(serverRoot, 'my-file.txt'), 'server root bytes');
        await writeFile(path.join(serverRoot, 'configured', 'my-file.txt'), 'configured root bytes');

        json(await invoke([
            'download',
            '-c',
            filename,
            '-s',
            '/my-file.txt',
            '-d',
            './subdir/downloaded-file.txt',
            '--json',
        ]));
        expect(await readFile(path.join(workingDirectory, 'subdir/downloaded-file.txt'), 'utf8')).toBe('server root bytes');
    });

    it('applies command defaults and lets explicit options override them', async () => {
        const filename = await configuration('ftp', {
            defaults: {overwrite: 'fail'},
            commands: {download: {sourceFile: 'my-file.txt', destinationFile: 'default-output.txt', overwrite: 'replace'}},
        });

        await writeFile(path.join(serverRoot, 'configured', 'my-file.txt'), 'from defaults');
        await writeFile(path.join(path.dirname(filename), 'default-output.txt'), 'original');

        json(await invoke(['download', '-c', filename, '--json']));
        expect(await readFile(path.join(path.dirname(filename), 'default-output.txt'), 'utf8')).toBe('from defaults');

        const failure = json(await invoke([
            'download',
            '-c',
            filename,
            '--overwrite',
            'fail',
            '--json',
        ]), 1);

        expect(failure.ok).toBe(false);
        expect(await readFile(path.join(path.dirname(filename), 'default-output.txt'), 'utf8')).toBe('from defaults');

        json(await invoke([
            'download',
            '-c',
            filename,
            '-d',
            'argument-output.txt',
            '--json',
        ]));
        expect(await readFile(path.join(workingDirectory, 'argument-output.txt'), 'utf8')).toBe('from defaults');
    });

    it('uses the default server filename and keeps JSON output when quiet is enabled', async () => {
        const filename = await configuration('ftp');

        await writeFile(path.join(workingDirectory, 'dockline.server.yml'), await readFile(filename));

        expect(json(await invoke(['list', '--json', '--quiet']))).toMatchObject({ok: true, command: 'list'});
    });

    it('resolves encrypted private-key files relative to the configuration directory', async () => {
        const filename = await configuration('sftp');
        const document = JSON.parse(await readFile(filename, 'utf8'));
        const keys = path.join(path.dirname(filename), 'keys');
        const initialPasswords = sftp.observations.passwords;

        await mkdir(keys, {recursive: true});
        await writeFile(path.join(keys, 'client.pem'), sftp.userKey.private);
        delete document.connection.password;

        document.connection.privateKeyPath = './keys/client.pem';
        document.connection.passphrase = 'fixture-passphrase';
        await writeFile(filename, JSON.stringify(document));

        expect(json(await invoke(['list', '-c', filename, '--json']))).toMatchObject({ok: true, command: 'list'});
        expect(sftp.observations.passwords).toBe(initialPasswords);
    });

    it('keeps existing local files unless download replacement is explicit', async () => {
        const filename = await configuration('sftp');

        sftp.files.set('/replace-test.txt', Buffer.from('remote replacement'));
        await writeFile(path.join(workingDirectory, 'replace-test.txt'), 'keep local');

        expect(json(await invoke([
            'download',
            '-c',
            filename,
            '-s',
            'replace-test.txt',
            '-d',
            'replace-test.txt',
            '--json',
        ]), 1).ok).toBe(false);
        expect(await readFile(path.join(workingDirectory, 'replace-test.txt'), 'utf8')).toBe('keep local');
        json(await invoke([
            'download',
            '-c',
            filename,
            '-s',
            'replace-test.txt',
            '-d',
            'replace-test.txt',
            '--overwrite',
            'replace',
            '--json',
        ]));
        expect(await readFile(path.join(workingDirectory, 'replace-test.txt'), 'utf8')).toBe('remote replacement');
    });

    it('refuses unsupported FTP no-replace uploads before opening a connection', async () => {
        const filename = await configuration('ftp');
        const initialConnections = ftpConnections;

        await writeFile(path.join(workingDirectory, 'no-replace.txt'), 'new content');

        const failure = json(await invoke([
            'upload',
            '-c',
            filename,
            '-s',
            'no-replace.txt',
            '-d',
            'no-replace.txt',
            '--overwrite',
            'fail',
            '--json',
        ]), 2);

        expect(failure.ok).toBe(false);
        expect(ftpConnections).toBe(initialConnections);
    });

    it('supports recursive listing and requires explicit recursive directory removal', async () => {
        const filename = await configuration('ftp', {defaults: {recursive: true}});

        await mkdir(path.join(serverRoot, 'configured/tree/subdir'), {recursive: true});
        await writeFile(path.join(serverRoot, 'configured/tree/subdir/leaf.txt'), 'leaf');

        const recursive = json(await invoke([
            'list',
            '-c',
            filename,
            '-p',
            'tree',
            '--json',
        ]));
        const shallow = json(await invoke([
            'list',
            '-c',
            filename,
            '-p',
            'tree',
            '--no-recursive',
            '--json',
        ]));

        expect(JSON.stringify(recursive)).toContain('leaf.txt');
        expect(JSON.stringify(shallow)).not.toContain('leaf.txt');
        expect(json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            'tree',
            '--no-recursive',
            '--json',
        ]), 1).ok).toBe(false);
        expect(await readFile(path.join(serverRoot, 'configured/tree/subdir/leaf.txt'), 'utf8')).toBe('leaf');
        json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            'tree',
            '-r',
            '--json',
        ]));
        expect(await readdir(path.join(serverRoot, 'configured'))).not.toContain('tree');
    });

    it.each([
        ['maxDepth', 0],
        ['maxEntries', 1],
    ] as const)('refuses incomplete recursive work under %s without deleting or returning partial entries', async (limit, value) => {
        const remote = 'bounded-' + limit;
        const filename = await configuration('ftp', {defaults: {recursive: true, [limit]: value}});
        const nested = path.join(serverRoot, 'configured', remote, 'subdir');

        await mkdir(nested, {recursive: true});
        await writeFile(path.join(nested, 'leaf.txt'), 'keep nested');
        await writeFile(path.join(path.dirname(nested), 'top.txt'), 'keep top');

        const removal = json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            remote,
            '--json',
        ]), 1);

        expect(removal.ok).toBe(false);
        expect(await readFile(path.join(nested, 'leaf.txt'), 'utf8')).toBe('keep nested');
        expect(await readFile(path.join(path.dirname(nested), 'top.txt'), 'utf8')).toBe('keep top');
        expect((await readdir(path.dirname(nested))).sort()).toEqual(['subdir', 'top.txt']);

        const listing = json(await invoke([
            'list',
            '-c',
            filename,
            '-p',
            remote,
            '--json',
        ]), 1);

        expect(listing.ok).toBe(false);
        expect(listing).not.toHaveProperty('entries');
    });

    it('removes an empty directory without recursive mode', async () => {
        const filename = await configuration('ftp');

        await mkdir(path.join(serverRoot, 'configured/empty-directory'));
        json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            'empty-directory',
            '--json',
        ]));
        expect(await readdir(path.join(serverRoot, 'configured'))).not.toContain('empty-directory');
    });

    it.each(['/', '.', '/configured/..'])('refuses recursive removal of root %s before authentication', async remote => {
        const filename = await configuration('ftp');
        const initialConnections = ftpConnections;
        const failure = json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            remote,
            '-r',
            '--json',
        ]), 2);

        expect(failure.ok).toBe(false);
        expect(ftpConnections).toBe(initialConnections);
    });

    it('refuses SFTP symbolic links without treating them as files', async () => {
        const filename = await configuration('sftp');
        const failure = json(await invoke([
            'remove',
            '-c',
            filename,
            '-p',
            '/link',
            '-r',
            '--json',
        ]), 1);

        expect(failure.ok).toBe(false);
        expect(sftp.observations.openHandles).toBe(0);
    });

    it('rejects malformed configuration, missing file arguments and invalid switches without connecting', async () => {
        const filename = await configuration('ftp');
        const malformed = path.join(directory, 'malformed.yml');
        const initialConnections = ftpConnections;

        await writeFile(malformed, 'connection: [unterminated');

        for (const arguments_ of [
            ['list', '-c', malformed, '--json'],
            ['download', '-c', filename, '--json'],
            [
                'upload',
                '-c',
                filename,
                '-s',
                'absent-file',
                '-d',
                'target',
                '--json',
            ],
            [
                'list',
                '-c',
                filename,
                '--max-timeout-retries',
                '5',
                '--json',
            ],
        ]) {
            expect(json(await invoke(arguments_), 2).ok).toBe(false);
        }

        expect(ftpConnections).toBe(initialConnections);
    });

    it('redacts authentication failures and emits exactly one JSON error', async () => {
        const filename = await configuration('sftp');
        const document = JSON.parse(await readFile(filename, 'utf8'));
        const password = 'private-fixture-password-never-log';

        document.connection.password = password;
        await writeFile(filename, JSON.stringify(document));

        const result = await invoke(['list', '-c', filename, '--json']);

        expect(json(result, 1)).toMatchObject({
            ok: false,
            error: {code: expect.any(String), message: expect.any(String)},
        });
        expect(result.stdout + result.stderr).not.toContain(password);
        expect(sftp.observations.openHandles).toBe(0);
    });

    it('rejects an untrusted noninteractive SFTP server before password authentication', async () => {
        const filename = await configuration('sftp');
        const document = JSON.parse(await readFile(filename, 'utf8'));
        const initialPasswords = sftp.observations.passwords;

        document.connection.trust = {fingerprint: 'SHA256:' + Buffer.alloc(32, 42).toString('base64').replace(/=+$/, '')};
        await writeFile(filename, JSON.stringify(document));

        expect(json(await invoke(['list', '-c', filename, '--json']), 1).ok).toBe(false);
        expect(sftp.observations.passwords).toBe(initialPasswords);
    });

    it('uses a remembered host key from a config-relative trust file without prompting or rewriting it', async () => {
        const filename = await configuration('sftp');
        const trustFile = path.join(path.dirname(filename), 'trusted-hosts.json');
        const store = await KnownHostsStore.open({file: trustFile});
        const document = JSON.parse(await readFile(filename, 'utf8'));

        await store.recordAccepted({
            host: '127.0.0.1',
            port: sftp.port,
            keyType: 'ssh-rsa',
            publicKey: sftp.publicKey,
            fingerprint: sftp.fingerprint,
            changed: false,
            abortSignal: new AbortController().signal,
        }, {approved: true, previousFingerprint: null});

        const before = await readFile(trustFile);

        document.connection.trust = {knownHostsFile: './trusted-hosts.json'};
        await writeFile(filename, JSON.stringify(document));

        expect(json(await invoke(['list', '-c', filename, '--json']))).toMatchObject({ok: true, command: 'list'});
        expect(await readFile(trustFile)).toEqual(before);
    });

    it('rejects unknown keys in a managed trust file during noninteractive operation', async () => {
        const filename = await configuration('sftp');
        const document = JSON.parse(await readFile(filename, 'utf8'));
        const initialPasswords = sftp.observations.passwords;

        document.connection.trust = {knownHostsFile: './unknown-hosts.json'};
        await writeFile(filename, JSON.stringify(document));

        expect(json(await invoke(['list', '-c', filename, '--json']), 1).ok).toBe(false);
        expect(sftp.observations.passwords).toBe(initialPasswords);
    });

    it('cancels the built command through its signal handler and cleans staged downloads', async () => {
        const filename = await configuration('sftp');
        const harness = path.join(directory, 'signal-harness.mjs');
        const destination = 'cancelled-download/file.bin';

        await writeFile(harness, `process.on('message', message => {
    if (message === 'cancel') process.emit('SIGINT');
});
await import(${JSON.stringify(pathToFileURL(executable).href)});
process.disconnect();
`);

        const operation = start([
            'download',
            '-c',
            filename,
            '-s',
            '/hang.bin',
            '-d',
            destination,
            '--json',
        ], harness, true);

        await expect.poll(() => sftp.observations.openHandles, {timeout: 5000}).toBeGreaterThan(0);
        operation.child.send('cancel');

        const result = await operation.result;

        expect(json(result, 130).ok).toBe(false);
        await expect.poll(() => sftp.observations.openHandles).toBe(0);
        expect(await readdir(path.join(workingDirectory, 'cancelled-download'))).toEqual([]);
    }, 10000);
});
