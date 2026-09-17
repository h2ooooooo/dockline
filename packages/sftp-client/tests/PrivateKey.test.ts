import {describe, it, expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import ssh2 from 'ssh2';
import {prepareSshPrivateKey, SshPrivateKeyError, SftpConnector} from '../src/index.js';
import {createLocalSftp} from './local-sftp.js';

const fixture = (name: string) => new URL(`./fixtures/ppk/${name}`, import.meta.url);
const load = (name: string) => readFile(fixture(name));
const fixtures = [
    ['v3_ecdsa.ppk', undefined],
    ['test_ed25519_puttygen_v3.ppk', undefined],
    ['test_ecdsa_nistp256_puttygen_v3.ppk', undefined],
    ['test_ecdsa_nistp384_2_puttygen_v3.ppk', undefined],
    ['test_ecdsa_nistp521_2_puttygen_v3.ppk', undefined],
    ['dsa_v3.ppk', undefined],
    ['v3_rsa_argon2id.ppk', 'changeit'],
    ['v3_rsa_argon2d.ppk', 'changeit'],
    ['v3_rsa_argon2i.ppk', 'changeit'],
] as const;

function parsedKey(input: string | Buffer) {
    const parsed = ssh2.utils.parseKey(input);

    if (parsed instanceof Error) {
        throw parsed;
    }

    return parsed;
}

describe('PuTTY PPK v3', () => {
    it.each(fixtures)('reads independent fixture %s without changing the input', async (name, password) => {
        const original = await load(name);
        const copy = Buffer.from(original);
        const converted = await prepareSshPrivateKey(original, password);
        const parsed = parsedKey(converted!);
        const publicBlob = /Public-Lines: (\d+)\r?\n([\s\S]+)/.exec(original.toString())!;
        const publicBytes = Buffer.from(publicBlob[2].split(/\r?\n/).slice(0, Number(publicBlob[1])).join(''), 'base64');

        expect(parsed.getPublicSSH()).toEqual(publicBytes);
        expect(original).toEqual(copy);

        if (password) {
            expect(parsed.getPublicSSH()).toEqual(parsedKey(await load('rsa-reference.openssh')).getPublicSSH());
        }
    });

    it('leaves existing key formats untouched', async () => {
        const key = await load('rsa-reference.openssh');

        expect(await prepareSshPrivateKey(undefined)).toBeUndefined();
        expect(await prepareSshPrivateKey(key)).toBe(key);
        expect(await prepareSshPrivateKey('PuTTY-User-Key-File-2: ssh-rsa')).toBe('PuTTY-User-Key-File-2: ssh-rsa');
    });

    it('accepts text keys and Buffer passphrases', async () => {
        const key = (await load('v3_rsa_argon2id.ppk')).toString();

        expect(parsedKey((await prepareSshPrivateKey(key, Buffer.from('changeit')))!).type).toBe('ssh-rsa');
    });

    it('distinguishes missing passphrases from bad passphrases and tampered data', async () => {
        const encrypted = await load('v3_rsa_argon2id.ppk');
        const unencrypted = (await load('v3_ecdsa.ppk')).toString();

        await expect(prepareSshPrivateKey(encrypted)).rejects.toMatchObject({reason: 'passphrase-required'});
        await expect(prepareSshPrivateKey(encrypted, 'wrong')).rejects.toMatchObject({reason: 'integrity'});
        await expect(prepareSshPrivateKey(unencrypted.replace('Comment: ', 'Comment: changed')))
            .rejects.toMatchObject({reason: 'integrity'});
        await expect(prepareSshPrivateKey(encrypted.toString().replace(/Private-MAC: ./, 'Private-MAC: f'), 'changeit'))
            .rejects.toBeInstanceOf(SshPrivateKeyError);
    });

    it('rejects malformed headers, invalid base64 and excessive resource requests', async () => {
        const key = (await load('v3_rsa_argon2id.ppk')).toString();
        const variants = [
            key.replace(/Argon2-Memory: \d+/, 'Argon2-Memory: 999999999'),
            key.replace(/Argon2-Passes: \d+/, 'Argon2-Passes: 101'),
            key.replace(/Argon2-Parallelism: \d+/, 'Argon2-Parallelism: 17'),
            key.replace(/Public-Lines: \d+/, 'Public-Lines: 999999999'),
            key.replace(/Private-Lines: \d+/, 'Private-Lines: 0'),
            key.replace(/Argon2-Salt: [a-f0-9]+/i, 'Argon2-Salt: invalid'),
            key.replace(/Public-Lines: (\d+)\r?\n./, 'Public-Lines: $1\n!'),
            key + '\nUnexpected: material\n',
            key.slice(0, 100),
            key + 'a'.repeat(1024 * 1024),
        ];

        for (const invalid of variants) {
            await expect(prepareSshPrivateKey(invalid, 'changeit')).rejects.toBeInstanceOf(SshPrivateKeyError);
        }
    });

    it.each(['path', 'provider'])('authenticates and downloads through SFTP using a PPK %s', async source => {
        const reference = await load('rsa-reference.openssh');
        const publicKey = parsedKey(reference);
        const server = await createLocalSftp({
            userKey: {
                private: reference.toString(),
                public: `${publicKey.type} ${publicKey.getPublicSSH().toString('base64')}`,
            },
        });
        const connector = new SftpConnector({
            host: '127.0.0.1',
            port: server.port,
            username: 'fixture',
            initialPath: '',
            hostVerifier: (key: Buffer) => key.equals(server.publicKey),
            ...(source === 'path' ? {
                privateKeyPath: fileURLToPath(fixture('v3_rsa_argon2id.ppk')),
                passphrase: 'changeit',
            } : {
                credentialProvider: async () => ({type: 'private-key' as const, privateKey: await load('v3_rsa_argon2id.ppk'), passphrase: 'changeit'}),
            }),
        });

        try {
            await connector.connect();

            const chunks: Buffer[] = [];

            for await (const chunk of await connector.read('/epoch.txt') as Readable) {
                chunks.push(Buffer.from(chunk));
            }

            expect(Buffer.concat(chunks).toString()).toBe('epoch');
        } finally {
            await connector.disconnect();
            await server.close();
        }
    });
});
