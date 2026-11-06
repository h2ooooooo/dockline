import {createHash, createPrivateKey} from 'node:crypto';
import type sshpk from 'sshpk';
import {parseKey, validateComment} from './parse.js';
import {writePpk} from './ppk-export.js';
import {readPpk} from './ppk.js';
import {encryptTraditionalPem} from './pem.js';
import {SshPrivateKeyError} from './errors.js';
import type {KeyInfo, KeyInput, KeyReadOptions, PrivateKeyExportOptions, PublicKeyExportOptions} from './types.js';

export {SshPrivateKeyError} from './errors.js';
export type {PrivateKeyFailure} from './errors.js';
export type * from './types.js';

function publicKey(key: sshpk.Key | sshpk.PrivateKey): sshpk.Key {
    return 'toPublic' in key ? key.toPublic() : key;
}

function fingerprint(key: sshpk.Key): string {
    return 'SHA256:' + createHash('sha256').update(key.toBuffer('rfc4253')).digest('base64').replace(/=+$/, '');
}

export async function inspectKey(input: KeyInput, options: KeyReadOptions = {}): Promise<KeyInfo> {
    const parsed = await parseKey(input, options);

    return {
        kind: parsed.private ? 'private' : 'public',
        format: parsed.format,
        algorithm: parsed.key.type as KeyInfo['algorithm'],
        bits: parsed.key.size,
        encrypted: parsed.encrypted,
        comment: parsed.key.comment ?? '',
        fingerprint: fingerprint(publicKey(parsed.key)),
        ...(parsed.ppkVersion ? {ppkVersion: parsed.ppkVersion} : {}),
    };
}

export async function fingerprintKey(input: KeyInput, options: KeyReadOptions = {}): Promise<string> {
    return (await inspectKey(input, options)).fingerprint;
}

export async function convertPrivateKey(input: KeyInput, options: PrivateKeyExportOptions): Promise<Buffer> {
    const parsed = await parseKey(input, options);

    if (!parsed.private) {
        throw new SshPrivateKeyError('unsupported', 'A public key cannot be converted into a private key.');
    }

    const key = parsed.key as sshpk.PrivateKey;

    if (options.comment !== undefined) {
        validateComment(options.comment);
        key.comment = options.comment;
    }

    try {
        switch (options.format) {
            case 'ppk':
                validateComment(key.comment ?? '');

                return await writePpk(key, options);
            case 'openssh':
                return key.toBuffer('ssh-private', {
                    ...(options.outputPassphrase !== undefined ?
                        {passphrase: options.outputPassphrase, cipher: 'aes256-ctr'} : {}),
                });
            case 'pkcs8': {
                const pem = key.toBuffer('pkcs8');

                try {
                    return Buffer.from(createPrivateKey(pem).export({
                        type: 'pkcs8',
                        format: 'pem',
                        ...(options.outputPassphrase !== undefined ?
                            {cipher: 'aes-256-cbc', passphrase: options.outputPassphrase} : {}),
                    }) as string);
                } finally {
                    pem.fill(0);
                }
            }

            case 'pkcs1':
            case 'sec1':
            case 'pem': {
                if (
                    options.format === 'pkcs1' &&
                    key.type !== 'rsa' ||
                    options.format === 'sec1' &&
                    key.type !== 'ecdsa' ||
                    key.type === 'ed25519'
                ) {
                    throw new SshPrivateKeyError('unsupported', 'This algorithm has no requested traditional PEM encoding.');
                }

                const pem = key.toBuffer('pkcs1');

                if (options.outputPassphrase === undefined) {
                    return pem;
                }

                try {
                    return encryptTraditionalPem(pem, options.outputPassphrase);
                } finally {
                    pem.fill(0);
                }
            }

            default:
                throw new SshPrivateKeyError('unsupported', 'The requested private-key output format is unsupported.');
        }
    } catch (error) {
        if (error instanceof SshPrivateKeyError) {
            throw error;
        }

        throw new SshPrivateKeyError('unsupported', 'The key cannot be exported in the requested format.');
    }
}

export async function convertPublicKey(input: KeyInput, options: PublicKeyExportOptions): Promise<Buffer> {
    const key = publicKey((await parseKey(input, options)).key);
    const comment = options.comment ?? key.comment ?? '';

    validateComment(comment);
    key.comment = comment;

    switch (options.format) {
        case 'openssh':
            return key.toBuffer('ssh');
        case 'spki':
            return key.toBuffer('pkcs8');
        case 'pkcs1':
            if (key.type !== 'rsa') {
                throw new SshPrivateKeyError('unsupported', 'PKCS#1 public-key export requires an RSA key.');
            }

            return key.toBuffer('pkcs1');
        case 'rfc4716': {
            const lines = key.toBuffer('rfc4253').toString('base64').match(/.{1,70}/g)!;
            const headers: string[] = [];
            let header = '';

            for (const character of comment ? 'Comment: ' + JSON.stringify(comment) : '') {
                if (Buffer.byteLength(header + character) > 71) {
                    headers.push(header + '\\');
                    header = '';
                }

                header += character;
            }

            if (header) {
                headers.push(header);
            }

            return Buffer.from([
                '---- BEGIN SSH2 PUBLIC KEY ----',
                ...headers,
                ...lines,
                '---- END SSH2 PUBLIC KEY ----',
                '',
            ].join('\n'));
        }

        default:
            throw new SshPrivateKeyError('unsupported', 'The requested public-key output format is unsupported.');
    }
}

/** Normalize any supported private format for SSH transport without writing key files. */
export async function preparePrivateKey(
    key: KeyInput | undefined,
    passphrase?: string | Buffer,
): Promise<Buffer | undefined> {
    if (key === undefined) {
        return undefined;
    }

    return convertPrivateKey(key, {format: 'openssh', inputPassphrase: passphrase});
}

/** Compatibility API: convert PPK v3 only and retain pass-through identity for all other inputs. */
export async function prepareSshPrivateKey(
    key: KeyInput | undefined,
    passphrase?: string | Buffer,
): Promise<KeyInput | undefined> {
    const prefix = Buffer.isBuffer(key) ? key.subarray(0, 32).toString('ascii') : key?.slice(0, 32);

    if (!prefix?.startsWith('PuTTY-User-Key-File-3:')) {
        return key;
    }

    return readPpk(key!, passphrase);
}
