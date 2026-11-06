import assert from 'node:assert/strict';
import {generateKeyPairSync, createHash} from 'node:crypto';
import ssh2 from 'ssh2';
import {SshClient} from '@jalsoedesign/dockline-ssh-client';

const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs1', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
});
const parsed = ssh2.utils.parseKey(key.privateKey);
const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
const clients = new Set();
const server = new ssh2.Server({hostKeys: [key.privateKey]}, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
        if (context.method === 'password' && context.username === 'fixture' && context.password === 'fixture-password') {
            context.accept();
        } else {
            context.reject();
        }
    });
    client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
        const channel = acceptExec();

        // A protocol fixture, not a shell: no received command is executed on this computer.
        if (info.command === "'whoami'") {
            channel.write('fixture\n');
            channel.exit(0);
        } else {
            channel.stderr.write('Demo command not supported\n');
            channel.exit(127);
        }

        channel.end();
    })));
});

try {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    console.log('SSH server started on 127.0.0.1 (temporary port).');

    const client = new SshClient({
        host: '127.0.0.1',
        port: server.address().port,
        username: 'fixture',
        password: 'fixture-password',
        hostFingerprint: fingerprint,
    });

    await client.withConnection(async session => {
        console.log("$ session.exec('whoami')");

        const result = await session.exec('whoami', [], {timeout: 5000});

        assert.equal(result.stdout, 'fixture\n');
        assert.equal(result.code, 0);
        console.log(JSON.stringify(result));
        console.log("$ session.exec('unsupported', [], {allowFailure: true})");

        const failed = await session.exec('unsupported', [], {allowFailure: true, timeout: 5000});

        assert.equal(failed.code, 127);
        console.log(JSON.stringify(failed));
    });
    console.log('PASS: pinned SSH authentication, stdout, stderr and exit codes.');
} finally {
    for (const client of clients) {
        client.end();
    }

    await new Promise(resolve => server.close(resolve));
    console.log('Local server stopped.');
}
