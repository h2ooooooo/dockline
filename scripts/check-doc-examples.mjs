import './check-doc-layout.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {localServer, temporaryDemo} from '../examples/demo-support.mjs';
import {convertPrivateKey, inspectKey} from '../packages/keys/dist/index.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const ssh2 = require('ssh2');
const ts = require('typescript');
const tsx = pathToFileURL(require.resolve('tsx')).href;
const root = path.join(repository, 'docs');
const manifest = JSON.parse(await readFile(path.join(root, 'example-variants.json'), 'utf8'));
const results = [];
const tsFiles = manifest.assets.filter(asset => asset.filename.endsWith('.ts')).map(asset => path.join(root, 'public/examples', asset.filename));
const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['node'],
    typeRoots: [path.join(repository, 'node_modules/@types')],
};
const program = ts.createProgram(tsFiles, options);
const diagnostics = ts.getPreEmitDiagnostics(program);

assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => repository,
    getNewLine: () => '\n',
}));
console.log(tsFiles.length + ' TypeScript example programs: strict type checking PASS.');

async function invoke(filename, directory, environment, parameters = []) {
    const args = [...(filename.endsWith('.ts') ? ['--import', tsx] : []), filename, ...parameters];
    const child = spawn(process.execPath, args, {
        cwd: directory,
        windowsHide: true,
        env: {...process.env, ...environment},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => child.kill(), 30000);

    child.stdout.on('data', chunk => {
        output += chunk;
    });
    child.stderr.on('data', chunk => {
        errors += chunk;
    });

    try {
        const code = await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', resolve);
        });

        assert.equal(code, 0, filename + '\n' + output + errors);

        return output;
    } finally {
        clearTimeout(timer);
    }
}

await temporaryDemo(async directory => {
    const sftp = await localServer('sftp', directory);
    const ftp = await localServer('ftp', directory);

    sftp.files.set('/hello.txt', Buffer.from('Hello from Dockline!'));
    sftp.files.set('hello.txt', Buffer.from('Hello from Dockline!'));

    const hostKey = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {format: 'pem', type: 'pkcs1'}, publicKeyEncoding: {format: 'pem', type: 'spki'}});
    const parsed = ssh2.utils.parseKey(hostKey.privateKey);
    const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
    const clients = new Set();
    const ssh = new ssh2.Server({hostKeys: [hostKey.privateKey]}, client => {
        clients.add(client);
        client.on('error', () => {});
        client.on('close', () => clients.delete(client));
        client.on('authentication', context => {
            if (
                context.method === 'password' &&
                context.username === 'fixture' &&
                context.password === 'fixture-password'
            ) {
                context.accept();
            } else {
                context.reject();
            }
        });
        client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
            const channel = acceptExec();

            assert.equal(info.command, "'whoami'");
            channel.write('fixture\n');
            channel.exit(0);
            channel.end();
        })));
    });

    try {
        await new Promise((resolve, reject) => {
            ssh.once('error', reject);
            ssh.listen(0, '127.0.0.1', resolve);
        });

        const pair = generateKeyPairSync('ed25519', {privateKeyEncoding: {format: 'pem', type: 'pkcs8'}, publicKeyEncoding: {format: 'pem', type: 'spki'}});
        const encrypted = await convertPrivateKey(pair.privateKey, {format: 'ppk', outputPassphrase: 'fixture-input'});

        for (const asset of manifest.assets) {
            const working = path.join(directory, asset.filename.replace('.', '-'));
            const checkDirectory = path.join(root, '.local-dev/example-checks');
            const filename = path.join(checkDirectory, asset.filename);
            let source = await readFile(path.join(root, 'public/examples', asset.filename), 'utf8');
            const isConnection = asset.name === 'connect';
            const isSsh = asset.name === 'ssh';
            const isTransfer = asset.name.startsWith('transfer-');
            const isUpload = asset.name === 'upload';
            const server = isSsh ? ssh.address() : sftp;

            await mkdir(working);
            await mkdir(checkDirectory, {recursive: true});

            // The documented default is port 22. Only the verification copy uses a temporary fixture port.
            if (isConnection || isSsh || asset.name === 'transfer-sftp' || isUpload) {
                source = source.replace('const port = 22;', 'const port = ' + server.port + ';');
                source = (source.includes('port: 22,') ? source.replace('port: 22,', 'port: ' + server.port + ',') : source.replace(/host: SFTP_HOST,/, 'host: SFTP_HOST,\n    port: ' + server.port + ','))
                    .replace('challenge.port === 22', 'challenge.port === ' + server.port);
            }

            if (asset.name === 'transfer-ftp') {
                source = source.replace("host: requiredEnv('FTP_HOST'),", "host: requiredEnv('FTP_HOST'),\n    port: " + ftp.port + ',');
            }

            if (isTransfer || isUpload) {
                await writeFile(path.join(working, 'hello.txt'), 'Hello from Dockline!');
            }

            if (asset.name === 'embedded-cli') {
                await writeFile(path.join(working, 'dockline.server.yml'), 'version: 1\nconnection:\n    protocol: sftp\n    host: 127.0.0.1\n    port: ' + sftp.port + '\n    username: fixture\n    password: fixture-password\n    trust:\n        fingerprint: ' + sftp.fingerprint + '\n');
            }

            if (asset.name === 'convert-key-file') {
                await writeFile(path.join(working, 'input.ppk'), encrypted);
            }

            await writeFile(filename, source);

            const output = await invoke(filename, working, {
                SFTP_HOST: '127.0.0.1',
                SFTP_USERNAME: 'fixture',
                SFTP_PASSWORD: 'fixture-password',
                SFTP_SHA256: isSsh ? fingerprint : sftp.fingerprint,
                INPUT_PASSPHRASE: 'fixture-input',
                OUTPUT_PASSPHRASE: 'fixture-output',
                FTP_HOST: '127.0.0.1',
                FTP_USERNAME: 'fixture',
                FTP_PASSWORD: 'fixture-password',
                NO_COLOR: '1',
            }, isUpload ? ['./hello.txt', 'uploaded-' + asset.filename] : []);

            if (isConnection) {
                assert.ok(output.includes('Directory listed.\nConnection closed.'));
            }

            if (isSsh) {
                assert.equal(output.trim(), 'fixture\nExit code: 0');
            }

            if (asset.name === 'inspect-key') {
                assert.equal(output.trim(), 'Kind: public\nFormat: openssh\nAlgorithm: ed25519\nEncrypted: false');
            }

            if (asset.name === 'convert-key') {
                assert.equal(output.trim(), 'PPK encrypted: true\nOpenSSH encrypted: true\nIdentity preserved: true');
            }

            if (asset.name === 'convert-key-file') {
                assert.equal(output.trim(), 'Saved encrypted output.openssh.');

                const exported = await inspectKey(await readFile(path.join(working, 'output.openssh')), {inputPassphrase: 'fixture-output'});

                assert.equal(exported.encrypted, true);
            }

            if (asset.name === 'describe-key') {
                assert.equal(output.trim(), 'Algorithm: ed25519\nSHA256 fingerprint: true');
            }

            if (asset.name === 'extract-public-key') {
                assert.equal(output.trim(), 'OpenSSH public key: true');
            }

            if (asset.name === 'change-passphrase') {
                assert.equal(output.trim(), 'Encrypted: true\nIdentity preserved: true');
            }

            if (isTransfer) {
                assert.equal(output.trim(), 'Uploaded hello.txt and downloaded a copy into the working directory.');
                assert.equal(await readFile(path.join(working, 'dockline-downloaded.txt'), 'utf8'), 'Hello from Dockline!');
            }

            if (isUpload) {
                assert.equal(output, '');
                assert.equal((sftp.files.get('/uploaded-' + asset.filename) ?? sftp.files.get('uploaded-' + asset.filename))?.toString(), 'Hello from Dockline!');
            }

            if (asset.name === 'embedded-cli') {
                assert.ok(output.includes('Downloaded 20 bytes:'));
                assert.equal(await readFile(path.join(working, 'downloaded-hello.txt'), 'utf8'), 'Hello from Dockline!');
            }

            assert.ok(!output.includes('PRIVATE KEY'));
            results.push({example: asset.filename, passed: true});
            console.log(asset.filename + ': PASS');
        }
    } finally {
        await sftp.close();
        await ftp.close();

        for (const client of clients) {
            client.end();
        }

        await new Promise(resolve => ssh.close(resolve));
    }
});

await writeFile(path.join(root, '.local-dev/example-checks/results.json'), JSON.stringify({strictTypeChecks: tsFiles.length, variants: results, externalConnections: false}, null, 4));
console.log(results.length + ' runnable language variants passed using local fixtures only.');
