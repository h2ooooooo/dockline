import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FtpSrv} from 'ftp-srv';
import {tsImport} from 'tsx/esm/api';

export const repository = fileURLToPath(new URL('../', import.meta.url));

export async function temporaryDemo(callback) {
    const directory = await mkdtemp(path.join(tmpdir(), 'connection-demo-'));

    try {
        await callback(directory);
    } finally {
        await rm(directory, {recursive: true, force: true});
        console.log('Temporary files removed.');
    }
}

export async function invokeCli(executable, args, directory, expectedCode = 0) {
    const child = spawn(process.execPath, [executable, ...args], {
        cwd: directory,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {...process.env, NO_COLOR: '1'},
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 20000);

    child.stdout.on('data', chunk => {
        stdout += chunk;
    });
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });

    try {
        const code = await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', resolve);
        });

        assert.equal(code, expectedCode, stdout + stderr);

        return JSON.parse(stdout || stderr);
    } finally {
        clearTimeout(timer);
    }
}

export async function localServer(protocol, directory) {
    if (protocol === 'sftp') {
        const {createLocalSftp} = await tsImport('../packages/sftp-client/tests/local-sftp.ts', import.meta.url);
        const server = await createLocalSftp();

        server.files.clear();

        return server;
    }

    const root = path.join(directory, 'ftp-root');
    const logger = Object.fromEntries([
        'info',
        'debug',
        'warn',
        'error',
        'trace',
        'fatal',
    ].map(name => [name, () => {}]));

    logger.child = () => logger;
    await mkdir(root);

    const server = new FtpSrv({
        url: 'ftp://127.0.0.1:0',
        pasv_url: '127.0.0.1',
        pasv_min: 0,
        pasv_max: 0,
        anonymous: false,
        log: logger,
    });

    server.on('login', ({username, password}, accept, reject) => {
        if (username === 'fixture' && password === 'fixture-password') {
            accept({root});
        } else {
            reject(new Error('Demo credentials rejected'));
        }
    });
    server.on('client-error', () => {});

    try {
        await server.listen();
    } catch (error) {
        await server.close();

        throw error;
    }

    return {port: server.server.address().port, close: () => server.close()};
}
