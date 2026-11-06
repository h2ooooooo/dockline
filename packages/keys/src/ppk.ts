import {createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import sshpk from 'sshpk';
import {SshPrivateKeyError} from './errors.js';
import {validatePrivateKey} from './validation.js';

const MAX_KEY_BYTES = 1024 * 1024;
const invalid = () => new SshPrivateKeyError('format', 'The PPK private key is malformed.');
const unsupported = () => new SshPrivateKeyError('unsupported', 'This PPK key algorithm or encryption method is unsupported.');

export function uint32(value: number): Buffer {
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32BE(value);

    return buffer;
}

export function field(value: Buffer | string): Buffer {
    const bytes = typeof value === 'string' ? Buffer.from(value) : value;

    return Buffer.concat([uint32(bytes.length), bytes]);
}

export class KeyReader {
    public offset = 0;

    public constructor(private readonly bytes: Buffer) {}

    public read(): Buffer {
        if (this.offset + 4 > this.bytes.length) {
            throw invalid();
        }

        const size = this.bytes.readUInt32BE(this.offset);

        this.offset += 4;

        if (size > this.bytes.length - this.offset) {
            throw invalid();
        }

        const result = this.bytes.subarray(this.offset, this.offset + size);

        this.offset += size;

        return result;
    }

    public integer(): Buffer {
        const result = this.read();

        if (!result.length || result[0] & 0x80 || result.length > 1 && result[0] === 0 && !(result[1] & 0x80)) {
            throw invalid();
        }

        return result;
    }
}

function nativePrivateKey(
    algorithm: string,
    publicKey: Buffer,
    privateKey: Buffer,
    encrypted: boolean,
    comment: Buffer,
): Buffer {
    const publicReader = new KeyReader(publicKey);
    const privateReader = new KeyReader(privateKey);
    const fields: Buffer[] = [];

    if (publicReader.read().toString() !== algorithm) {
        throw invalid();
    }

    if (algorithm === 'ssh-rsa') {
        const exponent = publicReader.integer();
        const modulus = publicReader.integer();
        const privateExponent = privateReader.integer();
        const p = privateReader.integer();
        const q = privateReader.integer();
        const inverse = privateReader.integer();

        fields.push(modulus, exponent, privateExponent, inverse, p, q);
    } else if (algorithm === 'ssh-dss') {
        for (let index = 0; index < 4; index++) {
            fields.push(publicReader.integer());
        }

        fields.push(privateReader.integer());
    } else if (/^ecdsa-sha2-nistp(256|384|521)$/.test(algorithm)) {
        const curve = publicReader.read();

        if (curve.toString() !== algorithm.slice('ecdsa-sha2-'.length)) {
            throw invalid();
        }

        fields.push(curve, publicReader.read(), privateReader.integer());
    } else if (algorithm === 'ssh-ed25519') {
        const publicBytes = publicReader.read();
        const integer = privateReader.read();
        const seed = integer.length === 33 && integer[0] === 0 ? integer.subarray(1) : integer;

        if (publicBytes.length !== 32 || seed.length > 32) {
            throw invalid();
        }

        fields.push(publicBytes, Buffer.concat([Buffer.alloc(32 - seed.length), seed, publicBytes]));
    } else {
        throw unsupported();
    }

    const padding = privateKey.length - privateReader.offset;

    if (publicReader.offset !== publicKey.length || padding < 0 || padding > (encrypted ? 15 : 0)) {
        throw invalid();
    }

    const check = randomBytes(4);
    const plain = Buffer.concat([
        check,
        check,
        field(algorithm),
        ...fields.map(field),
        field(comment),
    ]);
    const paddingLength = (8 - plain.length % 8) % 8;
    const padded = Buffer.concat([plain, Buffer.from(Array.from({length: paddingLength}, (_, index) => index + 1))]);
    const binary = Buffer.concat([
        Buffer.from('openssh-key-v1\0'),
        field('none'),
        field('none'),
        field(''),
        uint32(1),
        field(publicKey),
        field(padded),
    ]);
    const encoded = binary.toString('base64').match(/.{1,70}/g)!.join('\n');
    const output = Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${encoded}\n-----END OPENSSH PRIVATE KEY-----\n`);

    plain.fill(0);
    padded.fill(0);
    binary.fill(0);

    // Validate both the key representation and the public/private relationship before authentication.
    try {
        const parsed = sshpk.parsePrivateKey(output, 'ssh-private');

        if (!parsed.toPublic().toBuffer('rfc4253').equals(publicKey)) {
            throw invalid();
        }

        validatePrivateKey(parsed);
    } catch (error) {
        output.fill(0);

        if (error instanceof SshPrivateKeyError) {
            throw error;
        }

        throw invalid();
    }

    return output;
}

/** Verify PPK integrity and key consistency before producing an unencrypted OpenSSH representation. */
export async function readPpk(
    key: string | Buffer, passphrase?: string | Buffer,
): Promise<Buffer> {
    const prefix = Buffer.isBuffer(key) ? key.subarray(0, 32).toString('ascii') : key.slice(0, 32);
    const version = Number(/^PuTTY-User-Key-File-([23]):/.exec(prefix)?.[1]);

    if (version !== 2 && version !== 3) {
        throw unsupported();
    }

    if (Buffer.byteLength(key) > MAX_KEY_BYTES) {
        throw new SshPrivateKeyError('resource-limit', 'The PPK key exceeds the 1 MiB key-file limit.');
    }

    // Latin-1 keeps comments byte-for-byte intact for MAC verification, including non-UTF-8 comments.
    const bytes = Buffer.isBuffer(key) ? key : Buffer.from(key);
    const lines = bytes.toString('latin1').split(/\r\n|\r|\n/);
    let cursor = 0;
    const header = (name: string): string => {
        const line = lines[cursor++];

        if (!line?.startsWith(`${name}: `)) {
            throw invalid();
        }

        return line.slice(name.length + 2);
    };
    const integer = (name: string, maximum: number): number => {
        const value = header(name);
        const number = Number(value);

        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > maximum) {
            throw new SshPrivateKeyError('resource-limit', 'PPK lengths or Argon2 parameters exceed supported limits.');
        }

        return number;
    };
    const blob = (name: string): Buffer => {
        const count = integer(name, 16384);

        if (cursor + count > lines.length) {
            throw invalid();
        }

        const selected = lines.slice(cursor, cursor + count);

        cursor += count;

        if (selected.some(line => !/^[A-Za-z0-9+/]+={0,2}$/.test(line))) {
            throw invalid();
        }

        const encoded = selected.join('');
        const result = Buffer.from(encoded, 'base64');

        if (result.toString('base64') !== encoded) {
            throw invalid();
        }

        return result;
    };
    const algorithm = header('PuTTY-User-Key-File-' + version);
    const encryption = header('Encryption');
    const comment = Buffer.from(header('Comment'), 'latin1');
    const publicKey = blob('Public-Lines');
    let derivation: {
        variant: string;
        memory: number;
        passes: number;
        parallelism: number;
        salt: Buffer;
    } | undefined;

    if (!/^(ssh-rsa|ssh-dss|ssh-ed25519|ecdsa-sha2-nistp(256|384|521))$/.test(algorithm)) {
        throw unsupported();
    }

    if (encryption === 'aes256-cbc' && version === 3) {
        const variant = header('Key-Derivation');
        const memory = integer('Argon2-Memory', 262144);
        const passes = integer('Argon2-Passes', 100);
        const parallelism = integer('Argon2-Parallelism', 16);
        const salt = header('Argon2-Salt');

        if (!/^Argon2(d|i|id)$/.test(variant) || !/^(?:[0-9a-fA-F]{2}){8,64}$/.test(salt) || memory < 8 * parallelism) {
            throw invalid();
        }

        derivation = {
            variant,
            memory,
            passes,
            parallelism,
            salt: Buffer.from(salt, 'hex'),
        };
    } else if (encryption !== 'none' && encryption !== 'aes256-cbc') {
        throw unsupported();
    }

    const privateBlob = blob('Private-Lines');
    const mac = header('Private-MAC');

    if (
        !(version === 3 ? /^[0-9a-fA-F]{64}$/ : /^[0-9a-fA-F]{40}$/).test(mac) ||
        lines.slice(cursor).some(line => line !== '')
    ) {
        throw invalid();
    }

    let material: Buffer = version === 2 ? ppk2Material(encryption === 'none' ? Buffer.alloc(0) : passphrase ?? '') : Buffer.alloc(0);
    let plain: Buffer = privateBlob;
    let preimage: Buffer | undefined;

    try {
        if (encryption === 'aes256-cbc') {
            if (passphrase === undefined) {
                throw new SshPrivateKeyError('passphrase-required', 'This PPK private key is encrypted. Enter its passphrase.');
            }

            if (!privateBlob.length || privateBlob.length % 16) {
                throw invalid();
            }

            if (derivation) {
                const {argon2d, argon2i, argon2id} = await import('hash-wasm');
                const derive = {Argon2d: argon2d, Argon2i: argon2i, Argon2id: argon2id}[derivation.variant]!;

                material = Buffer.from(await derive({
                    password: passphrase,
                    salt: derivation.salt,
                    parallelism: derivation.parallelism,
                    iterations: derivation.passes,
                    memorySize: derivation.memory,
                    hashLength: 80,
                    outputType: 'binary',
                }));
            }

            const decipher = createDecipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32, 48));

            decipher.setAutoPadding(false);
            plain = Buffer.concat([decipher.update(privateBlob), decipher.final()]);
        }

        preimage = Buffer.concat([
            field(algorithm),
            field(encryption),
            field(comment),
            field(publicKey),
            field(plain),
        ]);

        const actualMac = createHmac(version === 3 ? 'sha256' : 'sha1', material.subarray(48)).update(preimage).digest();

        if (!timingSafeEqual(actualMac, Buffer.from(mac, 'hex'))) {
            throw new SshPrivateKeyError('integrity', 'PPK integrity verification failed. The passphrase is incorrect or the key file was modified.');
        }

        return nativePrivateKey(algorithm, publicKey, plain, encryption !== 'none', comment);
    } catch (error) {
        if (error instanceof SshPrivateKeyError) {
            throw error;
        }

        throw invalid();
    } finally {
        material.fill(0);
        plain.fill(0);
        privateBlob.fill(0);
        preimage?.fill(0);
    }
}

export function ppk2Material(passphrase: string | Buffer): Buffer {
    const password = Buffer.from(passphrase);
    const first = createHash('sha1').update(uint32(0)).update(password).digest();
    const second = createHash('sha1').update(uint32(1)).update(password).digest();
    const mac = createHash('sha1').update('putty-private-key-file-mac-key').update(password).digest();
    const material = Buffer.concat([Buffer.concat([first, second]).subarray(0, 32), Buffer.alloc(16), mac]);

    password.fill(0);
    first.fill(0);
    second.fill(0);
    mac.fill(0);

    return material;
}
