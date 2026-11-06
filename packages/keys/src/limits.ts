import {KeyReader} from './ppk.js';
import {SshPrivateKeyError} from './errors.js';

const malformed = () => new SshPrivateKeyError('format', 'The key encoding is malformed.');

/** Bounded DER navigation for encrypted PKCS#8 KDF parameters, not a cryptographic implementation. */
class DerReader {
    private offset = 0;

    constructor(private readonly bytes: Buffer) {}

    public read(tag: number): Buffer {
        if (this.offset + 2 > this.bytes.length || this.bytes[this.offset++] !== tag) {
            throw malformed();
        }

        let length = this.bytes[this.offset++];

        if (length & 0x80) {
            const count = length & 0x7f;

            if (!count || count > 4 || this.offset + count > this.bytes.length) {
                throw malformed();
            }

            length = this.bytes.readUIntBE(this.offset, count);
            this.offset += count;
        }

        if (length > this.bytes.length - this.offset) {
            throw malformed();
        }

        const value = this.bytes.subarray(this.offset, this.offset + length);

        this.offset += length;

        return value;
    }
}

export function checkInput(input: string | Buffer): string {
    if (Buffer.byteLength(input) > 1024 * 1024) {
        throw new SshPrivateKeyError('resource-limit', 'The key exceeds the 1 MiB key-file limit.');
    }

    return input.toString();
}

export function strictBase64(encoded: string): Buffer {
    const compact = encoded.replace(/\s/g, '');
    const bytes = Buffer.from(compact, 'base64');

    if (!compact || bytes.toString('base64') !== compact) {
        throw malformed();
    }

    return bytes;
}

export function pemBytes(text: string): Buffer {
    const match = /^-----BEGIN ([A-Z0-9 ]+)-----\r?\n([\s\S]*?)\r?\n-----END \1-----\s*$/.exec(text.trim());

    if (!match) {
        throw malformed();
    }

    return strictBase64(match[2]);
}

export function checkKdfLimits(text: string): Buffer | undefined {
    if (text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) {
        const bytes = pemBytes(text);
        const magic = Buffer.from('openssh-key-v1\0');

        if (!bytes.subarray(0, magic.length).equals(magic)) {
            throw malformed();
        }

        const reader = new KeyReader(bytes.subarray(magic.length));
        const cipher = reader.read().toString();
        const kdf = reader.read().toString();
        const parameters = reader.read();

        if (kdf === 'bcrypt') {
            const options = new KeyReader(parameters);
            const salt = options.read();

            if (options.offset + 4 !== parameters.length || salt.length < 8 || salt.length > 64) {
                throw malformed();
            }

            const rounds = parameters.readUInt32BE(options.offset);

            if (!rounds || rounds > 128) {
                throw new SshPrivateKeyError('resource-limit', 'OpenSSH bcrypt rounds exceed supported limits.');
            }
        } else if (kdf !== 'none' || cipher !== 'none') {
            throw new SshPrivateKeyError('unsupported', 'This OpenSSH key derivation method is unsupported.');
        }

        if (reader.offset + 4 > bytes.length - magic.length) {
            throw malformed();
        }

        const count = bytes.readUInt32BE(magic.length + reader.offset);

        reader.offset += 4;

        if (count !== 1) {
            throw new SshPrivateKeyError('unsupported', 'Only single-key OpenSSH files are supported.');
        }

        const publicKey = reader.read();

        reader.read();

        if (reader.offset !== bytes.length - magic.length) {
            throw malformed();
        }

        return publicKey;
    } else if (text.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
        const outer = new DerReader(new DerReader(pemBytes(text)).read(0x30));
        const algorithm = new DerReader(outer.read(0x30));

        // PBES2 and PBKDF2 are the supported encrypted PKCS#8 family.
        if (algorithm.read(0x06).toString('hex') !== '2a864886f70d01050d') {
            throw new SshPrivateKeyError('unsupported', 'This PKCS#8 encryption method is unsupported.');
        }

        const parameters = new DerReader(algorithm.read(0x30));
        const kdf = new DerReader(parameters.read(0x30));

        if (kdf.read(0x06).toString('hex') !== '2a864886f70d01050c') {
            throw new SshPrivateKeyError('unsupported', 'This PKCS#8 key derivation method is unsupported.');
        }

        const options = new DerReader(kdf.read(0x30));
        const salt = options.read(0x04);
        const count = options.read(0x02);

        if (!count.length || count.length > 4 || count[0] & 0x80 || salt.length > 64) {
            throw malformed();
        }

        const rounds = count.readUIntBE(0, count.length);

        if (!rounds || rounds > 1000000) {
            throw new SshPrivateKeyError('resource-limit', 'PKCS#8 PBKDF2 rounds exceed supported limits.');
        }
    }
}
