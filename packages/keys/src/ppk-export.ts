import {createCipheriv, createHmac, randomBytes} from 'node:crypto';
import type sshpk from 'sshpk';
import type {PrivateKeyExportOptions} from './types.js';
import {field, KeyReader, ppk2Material} from './ppk.js';
import {SshPrivateKeyError} from './errors.js';

function positiveInteger(bytes: Buffer): Buffer {
    let offset = 0;

    while (offset < bytes.length - 1 && bytes[offset] === 0) {
        offset++;
    }

    const value = bytes.subarray(offset);

    return value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
}

function privateBlob(key: sshpk.PrivateKey): Buffer {
    const names: Record<string, sshpk.AlgorithmPart[]> = {
        rsa: ['d', 'p', 'q', 'iqmp'],
        dsa: ['x'],
        ecdsa: ['d'],
        ed25519: ['k'],
    };
    const parts = names[key.type];

    if (!parts) {
        throw new SshPrivateKeyError('unsupported', 'This key algorithm is unsupported.');
    }

    return Buffer.concat(parts.map(name => {
        const part = key.parts.find(item => item.name === name);

        if (!part) {
            throw new SshPrivateKeyError('format', 'The private key is incomplete.');
        }

        return field(positiveInteger(part.data));
    }));
}

function base64Lines(bytes: Buffer): string[] {
    return bytes.toString('base64').match(/.{1,64}/g) ?? [];
}

export async function writePpk(key: sshpk.PrivateKey, options: PrivateKeyExportOptions): Promise<Buffer> {
    const version = options.ppkVersion ?? 3;
    const encrypted = options.outputPassphrase !== undefined;
    const encryption = encrypted ? 'aes256-cbc' : 'none';
    const comment = options.comment ?? key.comment ?? '';
    const publicBytes = key.toPublic().toBuffer('rfc4253');
    const algorithm = new KeyReader(publicBytes).read().toString();
    const commentBytes = Buffer.from(comment);
    const password = Buffer.from(options.outputPassphrase ?? '');
    let plain = privateBlob(key);
    let material: Buffer = version === 2 ? ppk2Material(password) : Buffer.alloc(0);
    let blob: Buffer = plain;
    const headers: string[] = [];

    if (version !== 2 && version !== 3) {
        throw new SshPrivateKeyError('unsupported', 'Only PPK versions 2 and 3 are supported.');
    }

    try {
        if (encrypted) {
            const padded = Buffer.concat([plain, randomBytes((16 - plain.length % 16) % 16)]);

            plain.fill(0);
            plain = padded;

            if (version === 3) {
                const memory = options.argon2?.memoryKiB ?? 65536;
                const passes = options.argon2?.passes ?? 3;
                const parallelism = options.argon2?.parallelism ?? 1;

                if (
                    !Number.isSafeInteger(memory) ||
                    memory > 262144 ||
                    memory < 8 * parallelism ||
                    !Number.isSafeInteger(passes) ||
                    passes < 1 ||
                    passes > 100 ||
                    !Number.isSafeInteger(parallelism) ||
                    parallelism < 1 ||
                    parallelism > 16
                ) {
                    throw new SshPrivateKeyError('resource-limit', 'Argon2 parameters exceed supported limits.');
                }

                const salt = randomBytes(16);
                const {argon2id} = await import('hash-wasm');

                material = Buffer.from(await argon2id({
                    password,
                    salt,
                    parallelism,
                    iterations: passes,
                    memorySize: memory,
                    hashLength: 80,
                    outputType: 'binary',
                }));
                headers.push(
                    'Key-Derivation: Argon2id',
                    'Argon2-Memory: ' + memory,
                    'Argon2-Passes: ' + passes,
                    'Argon2-Parallelism: ' + parallelism,
                    'Argon2-Salt: ' + salt.toString('hex'),
                );
            }

            const cipher = createCipheriv('aes-256-cbc', material.subarray(0, 32), material.subarray(32, 48));

            cipher.setAutoPadding(false);
            blob = Buffer.concat([cipher.update(plain), cipher.final()]);
        }

        const mac = createHmac(version === 3 ? 'sha256' : 'sha1', material.subarray(48))
            .update(field(algorithm))
            .update(field(encryption))
            .update(field(commentBytes))
            .update(field(publicBytes))
            .update(field(plain))
            .digest('hex');
        const publicLines = base64Lines(publicBytes);
        const privateLines = base64Lines(blob);
        const lines = [
            'PuTTY-User-Key-File-' + version + ': ' + algorithm,
            'Encryption: ' + encryption,
            'Comment: ' + comment,
            'Public-Lines: ' + publicLines.length,
            ...publicLines,
            ...headers,
            'Private-Lines: ' + privateLines.length,
            ...privateLines,
            'Private-MAC: ' + mac,
            '',
        ];

        return Buffer.from(lines.join('\n'));
    } finally {
        password.fill(0);
        material.fill(0);
        plain.fill(0);
        blob.fill(0);
    }
}
