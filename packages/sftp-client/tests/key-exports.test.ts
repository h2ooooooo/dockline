import {expect, it} from 'vitest';
import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, convertPublicKey} from '@jalsoedesign/dockline-keys';
import {SftpConnector} from '../src/index.js';
import {createLocalSftp} from './local-sftp.js';

it.each(['pkcs8', 'ppk2'] as const)('authenticates SFTP using a new encrypted %s export', async format => {
    const original = generateKeyPairSync('ed25519').privateKey.export({format: 'pem', type: 'pkcs8'});
    const server = await createLocalSftp({
        userKey: {
            private: (await convertPrivateKey(original, {format: 'openssh'})).toString(),
            public: (await convertPublicKey(original, {format: 'openssh'})).toString(),
        },
    });
    const exported = await convertPrivateKey(original, {
        format: format === 'ppk2' ? 'ppk' : 'pkcs8',
        ppkVersion: 2,
        outputPassphrase: 'synthetic-secret',
    });
    const client = new SftpConnector({
        host: '127.0.0.1',
        port: server.port,
        username: 'fixture',
        initialPath: '',
        hostVerifier: (key: Buffer) => key.equals(server.publicKey),
        credentialProvider: () => ({type: 'private-key', privateKey: exported, passphrase: 'synthetic-secret'}),
    });

    try {
        await client.connect();
        expect(await client.fileExists('/epoch.txt')).toBe(true);
    } finally {
        await client.disconnect();
        await server.close();
    }
});
