import {expect, it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Dockline} from '../src/Dockline.js';
import {createLocalSftp} from '../../sftp-client/tests/local-sftp.js';

it('authenticates with the fixed public Ed25519 test identity without password fallback', async () => {
    const userKey = {
        private: await readFile(new URL('../../sftp-client/tests/fixtures/public-test-ed25519-key.pem', import.meta.url), 'utf8'),
        public: await readFile(new URL('../../sftp-client/tests/fixtures/public-test-ed25519-key.pub', import.meta.url), 'utf8'),
    };
    const endpoint = await createLocalSftp({userKey});

    try {
        const result = await Dockline.withConnection({
            protocol: 'sftp',
            host: '127.0.0.1',
            port: endpoint.port,
            username: 'fixture',
            privateKey: userKey.private,
            passphrase: 'fixture-passphrase',
            root: '/',
            timeoutMs: 5000,
            maxTransientRetries: 0,
            requireTrustPolicy: true,
            hasTrustPolicy: challenge => challenge.fingerprint === endpoint.fingerprint,
            acceptTrustPolicy: () => false,
        }, async remote => {
            const stream = await remote.read('epoch.txt');
            const bytes: Buffer[] = [];

            for await (const part of stream) {
                bytes.push(Buffer.from(part));
            }

            return Buffer.concat(bytes).toString();
        });

        expect(result).toBe('epoch');
        expect(endpoint.observations.passwords).toBe(0);
        expect(endpoint.observations.connections).toBe(1);
    } finally {
        await endpoint.close();
    }
});
