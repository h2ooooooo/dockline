import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHash, createPrivateKey, createPublicKey, generateKeyPairSync} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ssh2 from 'ssh2';
import {
    convertPrivateKey, convertPublicKey, fingerprintKey, inspectKey,
    preparePrivateKey, prepareSshPrivateKey, SshPrivateKeyError,
    type PrivateKeyExportOptions,
} from '../src/index.js';

const algorithms = [
    'rsa',
    'ed25519',
    'nistp256',
    'nistp384',
    'nistp521',
    'dsa',
] as const;
const keys = new Map<string, {privateKey: Buffer; publicKey: Buffer}>();
const cheapArgon = {memoryKiB: 1024, passes: 1, parallelism: 1};
const password = 'synthetic export password';

beforeAll(() => {
    for (const algorithm of algorithms) {
        const generated = algorithm === 'rsa' ? generateKeyPairSync('rsa', {modulusLength: 2048}) :
            algorithm === 'ed25519' ? generateKeyPairSync('ed25519') :
                algorithm === 'dsa' ? generateKeyPairSync('dsa', {modulusLength: 1024, divisorLength: 160}) :
                    generateKeyPairSync('ec', {namedCurve: {nistp256: 'prime256v1', nistp384: 'secp384r1', nistp521: 'secp521r1'}[algorithm]});

        keys.set(algorithm, {
            privateKey: Buffer.from(generated.privateKey.export({format: 'pem', type: 'pkcs8'})),
            publicKey: generated.publicKey.export({format: 'der', type: 'spki'}),
        });
    }
});

function nativePublic(input: Buffer): Buffer {
    return createPublicKey(createPrivateKey(input)).export({format: 'der', type: 'spki'});
}

describe('private-key formats', () => {
    it.each(algorithms)('preserves %s identity across every applicable private format', async algorithm => {
        const original = keys.get(algorithm)!;
        const formats: PrivateKeyExportOptions[] = [
            {format: 'openssh'},
            {format: 'pkcs8'},
            {format: 'ppk', ppkVersion: 2},
            {format: 'ppk', ppkVersion: 3},
        ];

        if (algorithm !== 'ed25519') {
            formats.push({format: 'pem'});
        }

        if (algorithm === 'rsa') {
            formats.push({format: 'pkcs1'});
        } else if (algorithm.startsWith('nistp')) {
            formats.push({format: 'sec1'});
        }

        for (const options of formats) {
            const output = await convertPrivateKey(original.privateKey, options);
            const normalized = await convertPrivateKey(output, {format: 'pkcs8'});

            expect(Buffer.isBuffer(output)).toBe(true);
            expect(nativePublic(normalized)).toEqual(original.publicKey);
            expect((await inspectKey(output)).kind).toBe('private');
            expect(await fingerprintKey(output)).toBe(await fingerprintKey(original.privateKey));
        }
    });

    it.each(['rsa', 'ed25519', 'nistp256', 'dsa'])('encrypts every applicable %s output and changes its passphrase', async algorithm => {
        const original = keys.get(algorithm)!;
        const formats: PrivateKeyExportOptions[] = [
            {format: 'openssh'},
            {format: 'pkcs8'},
            {format: 'ppk', ppkVersion: 2},
            {format: 'ppk', ppkVersion: 3, argon2: cheapArgon},
        ];

        if (algorithm !== 'ed25519') {
            formats.push({format: 'pem'});
        }

        for (const options of formats) {
            const encrypted = await convertPrivateKey(original.privateKey, {...options, outputPassphrase: password});

            await expect(inspectKey(encrypted)).rejects.toMatchObject({reason: 'passphrase-required'});
            await expect(inspectKey(encrypted, {inputPassphrase: 'wrong'})).rejects.toMatchObject({reason: 'integrity'});
            expect((await inspectKey(encrypted, {inputPassphrase: password})).encrypted).toBe(true);

            const changed = await convertPrivateKey(encrypted, {
                ...options,
                inputPassphrase: password,
                outputPassphrase: 'replacement-password',
            });
            const decoded = await convertPrivateKey(changed, {format: 'pkcs8', inputPassphrase: 'replacement-password'});

            expect(nativePublic(decoded)).toEqual(original.publicKey);
        }
    });

    it.each([
        'test_ed25519_puttygen_v3.ppk',
        'test_ecdsa_nistp256_puttygen_v3.ppk',
        'test_ecdsa_nistp384_2_puttygen_v3.ppk',
        'test_ecdsa_nistp521_2_puttygen_v3.ppk',
        'dsa_v3.ppk',
        'v3_rsa_argon2id.ppk',
        'v3_rsa_argon2d.ppk',
        'v3_rsa_argon2i.ppk',
    ])('reads the independently generated fixture %s', async filename => {
        const bytes = await readFile(new URL('../../sftp-client/tests/fixtures/ppk/' + filename, import.meta.url));
        const copy = Buffer.from(bytes);
        const encrypted = filename.includes('argon2');
        const output = await convertPrivateKey(bytes, {format: 'openssh', inputPassphrase: encrypted ? 'changeit' : undefined});
        const parsed = ssh2.utils.parseKey(output);

        expect(parsed).not.toBeInstanceOf(Error);
        expect(bytes).toEqual(copy);
    });

    it('writes RSA PPK v2 accepted by the independent SSH transport parser', async () => {
        const original = keys.get('rsa')!;
        const openssh = await convertPrivateKey(original.privateKey, {format: 'openssh'});
        const expected = ssh2.utils.parseKey(openssh);

        for (const outputPassphrase of [undefined, password]) {
            const ppk = await convertPrivateKey(original.privateKey, {format: 'ppk', ppkVersion: 2, outputPassphrase});
            const parsed = ssh2.utils.parseKey(ppk, outputPassphrase);

            expect(parsed).not.toBeInstanceOf(Error);

            if (parsed instanceof Error || expected instanceof Error) {
                throw new Error('Independent key parsing failed');
            }

            expect(parsed.getPublicSSH()).toEqual(expected.getPublicSSH());
        }
    });

    it('retains Unicode comments through PPK and OpenSSH, and retains compatibility pass-through identity', async () => {
        const input = keys.get('ed25519')!.privateKey;
        const ppk = await convertPrivateKey(input, {format: 'ppk', comment: 'déploiement 🔑'});
        const openssh = await convertPrivateKey(ppk, {format: 'openssh'});

        expect((await inspectKey(openssh)).comment).toBe('déploiement 🔑');
        expect(await prepareSshPrivateKey(input)).toBe(input);
        expect(await prepareSshPrivateKey(undefined)).toBeUndefined();
        expect(await prepareSshPrivateKey('PuTTY-User-Key-File-2: ssh-rsa')).toBe('PuTTY-User-Key-File-2: ssh-rsa');
        expect(await preparePrivateKey(undefined)).toBeUndefined();
        expect((await preparePrivateKey(input))?.toString()).toContain('BEGIN OPENSSH PRIVATE KEY');
    });
});

describe('public keys and fingerprints', () => {
    it.each(algorithms)('extracts and converts %s public keys without leaking private fields', async algorithm => {
        const original = keys.get(algorithm)!;
        const expected = await fingerprintKey(original.privateKey);

        for (const format of ['openssh', 'rfc4716', 'spki'] as const) {
            const output = await convertPublicKey(original.privateKey, {format, comment: 'public comment'});
            const info = await inspectKey(output);

            expect(info.kind).toBe('public');
            expect(info.fingerprint).toBe(expected);
            expect(output.toString()).not.toContain('PRIVATE KEY');
            await expect(convertPrivateKey(output, {format: 'openssh'})).rejects.toMatchObject({reason: 'unsupported'});
        }

        const spki = await convertPublicKey(original.privateKey, {format: 'spki'});

        expect(createPublicKey(spki).export({format: 'der', type: 'spki'})).toEqual(original.publicKey);
    });

    it('exports RSA PKCS#1 public keys accepted by Node crypto', async () => {
        const output = await convertPublicKey(keys.get('rsa')!.privateKey, {format: 'pkcs1'});

        expect(createPublicKey(output).export({format: 'der', type: 'spki'})).toEqual(keys.get('rsa')!.publicKey);
    });
});

describe('validation and resource bounds', () => {
    it('rejects tampering, invalid comments, excessive Argon2 parameters and oversized inputs', async () => {
        const input = keys.get('rsa')!.privateKey;
        const ppk = await convertPrivateKey(input, {format: 'ppk', comment: 'original'});

        await expect(inspectKey(ppk.toString().replace('Comment: original', 'Comment: modified')))
            .rejects.toMatchObject({reason: 'integrity'});
        await expect(convertPrivateKey(input, {format: 'ppk', comment: 'line\ninjection'}))
            .rejects.toMatchObject({reason: 'format'});
        await expect(convertPrivateKey(input, {
            format: 'ppk',
            outputPassphrase: password,
            argon2: {memoryKiB: 999999999},
        })).rejects.toMatchObject({reason: 'resource-limit'});
        await expect(inspectKey(Buffer.alloc(1024 * 1024 + 1))).rejects.toMatchObject({reason: 'resource-limit'});
        await expect(inspectKey('not a key')).rejects.toBeInstanceOf(SshPrivateKeyError);
        await expect(convertPrivateKey(keys.get('ed25519')!.privateKey, {format: 'pem'}))
            .rejects.toMatchObject({reason: 'unsupported'});
    });

    it('rejects an excessive OpenSSH bcrypt work factor before derivation', async () => {
        const encrypted = await convertPrivateKey(keys.get('rsa')!.privateKey, {format: 'openssh', outputPassphrase: password});
        const text = encrypted.toString();
        const binary = Buffer.from(text.split('\n').slice(1, -2).join(''), 'base64');
        let offset = Buffer.byteLength('openssh-key-v1\0');

        for (let index = 0; index < 2; index++) {
            offset += 4 + binary.readUInt32BE(offset);
        }

        const parametersStart = offset + 4;
        const saltLength = binary.readUInt32BE(parametersStart);

        binary.writeUInt32BE(999999999, parametersStart + 4 + saltLength);

        const malformed = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\n' +
            binary.toString('base64').match(/.{1,70}/g)!.join('\n') + '\n-----END OPENSSH PRIVATE KEY-----\n');

        await expect(inspectKey(malformed, {inputPassphrase: password})).rejects.toMatchObject({reason: 'resource-limit'});
    });
});

describe('OpenSSH interoperability', () => {
    let directory: string;

    beforeAll(async () => {
        directory = await mkdtemp(path.join(tmpdir(), 'dockline-keys-'));
    });

    afterAll(async () => {
        if (directory && path.basename(directory).startsWith('dockline-keys-') && path.dirname(directory) === tmpdir()) {
            await rm(directory, {recursive: true, force: true});
        }
    });

    it('exports an encrypted OpenSSH key that ssh-keygen can decrypt', async context => {
        const probe = spawnSync('ssh-keygen', ['-?'], {encoding: 'utf8', timeout: 3000, windowsHide: true});

        if ((probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
            context.skip();

            return;
        }

        const output = await convertPrivateKey(keys.get('ed25519')!.privateKey, {format: 'openssh', outputPassphrase: password});
        const filename = path.join(directory, 'id_test');

        await writeFile(filename, output, {mode: 0o600});

        if (process.platform === 'win32') {
            const script = '$filePath = [Console]::In.ReadToEnd(); ' +
                '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent(); ' +
                '$acl = New-Object System.Security.AccessControl.FileSecurity; ' +
                '$acl.SetOwner($identity.User); $acl.SetAccessRuleProtection($true, $false); ' +
                '$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, "FullControl", "Allow"); ' +
                '$acl.AddAccessRule($rule); [System.IO.File]::SetAccessControl($filePath, $acl)';
            const secured = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
                input: filename,
                encoding: 'utf8',
                timeout: 15000,
                windowsHide: true,
            });

            expect(secured.status, secured.stderr).toBe(0);
        }

        const result = spawnSync('ssh-keygen', [
            '-y',
            '-P',
            password,
            '-f',
            filename,
        ], {
            encoding: 'utf8',
            timeout: 15000,
            windowsHide: true,
        });

        expect(result.status, result.stderr).toBe(0);
        expect(await fingerprintKey(result.stdout)).toBe(await fingerprintKey(output, {inputPassphrase: password}));

        const blob = Buffer.from(result.stdout.trim().split(/\s+/)[1], 'base64');

        expect(await fingerprintKey(output, {inputPassphrase: password})).toBe(
            'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, ''),
        );
    });
});

it('wraps long RFC4716 comments by UTF-8 byte length and preserves them', async () => {
    const comment = 'déploiement 🔑 '.repeat(30);
    const output = await convertPublicKey(keys.get('ed25519')!.privateKey, {format: 'rfc4716', comment});

    expect(output.toString().trim().split('\n').every(line => Buffer.byteLength(line) <= 72)).toBe(true);
    expect((await inspectKey(output)).comment).toBe(comment);
});

it('rejects a mismatched OpenSSH outer public key', async () => {
    const output = await convertPrivateKey(keys.get('ed25519')!.privateKey, {format: 'openssh'});
    const binary = Buffer.from(output.toString().split('\n').slice(1, -2).join(''), 'base64');
    let offset = Buffer.byteLength('openssh-key-v1\0');

    for (let index = 0; index < 3; index++) {
        offset += 4 + binary.readUInt32BE(offset);
    }

    offset += 4;

    const length = binary.readUInt32BE(offset);

    binary[offset + 4 + length - 1] ^= 1;

    const malformed = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\n' +
        binary.toString('base64').match(/.{1,70}/g)!.join('\n') + '\n-----END OPENSSH PRIVATE KEY-----\n');

    await expect(inspectKey(malformed)).rejects.toMatchObject({reason: 'integrity'});
});

it('rejects excessive PBKDF2 parameters before attempting PKCS#8 decryption', async () => {
    const field = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag, value.length]), value]);
    const sequence = (...fields: Buffer[]) => field(0x30, Buffer.concat(fields));
    const pbkdf2 = sequence(
        field(0x06, Buffer.from('2a864886f70d01050c', 'hex')),
        sequence(field(0x04, Buffer.alloc(8)), field(0x02, Buffer.from('3fffffff', 'hex'))),
    );
    const encoded = sequence(sequence(
        field(0x06, Buffer.from('2a864886f70d01050d', 'hex')),
        sequence(pbkdf2),
    ));
    const hostile = Buffer.from('-----BEGIN ENCRYPTED PRIVATE KEY-----\n' +
        encoded.toString('base64') + '\n-----END ENCRYPTED PRIVATE KEY-----\n');

    await expect(inspectKey(hostile, {inputPassphrase: password})).rejects.toMatchObject({reason: 'resource-limit'});
});
