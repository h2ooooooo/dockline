import {createPrivateKey} from 'node:crypto';
import sshpk from 'sshpk';
import type {KeyInfo, KeyInput, KeyReadOptions} from './types.js';
import {readPpk} from './ppk.js';
import {checkInput, checkKdfLimits, strictBase64} from './limits.js';
import {SshPrivateKeyError} from './errors.js';
import {validateAlgorithm, validatePrivateKey} from './validation.js';

export interface ParsedKey {
    key: sshpk.Key | sshpk.PrivateKey;
    format: KeyInfo['format'];
    encrypted: boolean;
    private: boolean;
    ppkVersion?: 2 | 3;
}

export function validateComment(comment: string): void {
    if (typeof comment !== 'string' || /[\0\r\n]/.test(comment) || Buffer.byteLength(comment) > 4096) {
        throw new SshPrivateKeyError('format', 'Key comments must fit one line and at most 4096 bytes.');
    }
}

function readRfc4716(text: string): sshpk.Key {
    const match = /^---- BEGIN SSH2 PUBLIC KEY ----\r?\n([\s\S]*?)\r?\n---- END SSH2 PUBLIC KEY ----$/.exec(text);

    if (!match) {
        throw new SshPrivateKeyError('format', 'The RFC4716 public key is malformed.');
    }

    const lines = match[1].split(/\r?\n/);
    const body: string[] = [];
    let comment = '';
    let readingBody = false;

    for (let index = 0; index < lines.length; index++) {
        let line = lines[index];

        if (!readingBody && /^[A-Za-z][A-Za-z0-9-]*:/.test(line)) {
            while (line.endsWith('\\')) {
                if (++index >= lines.length) {
                    throw new SshPrivateKeyError('format', 'The RFC4716 header is incomplete.');
                }

                line = line.slice(0, -1) + lines[index];
            }

            if (line.startsWith('Comment: ')) {
                const value = line.slice(9);

                comment = value.startsWith('"') ? JSON.parse(value) : value;
                validateComment(comment);
            }
        } else {
            readingBody = true;
            body.push(line);
        }
    }

    const key = sshpk.parseKey(strictBase64(body.join('')), 'rfc4253');

    key.comment = comment;

    return key;
}

export async function parseKey(input: KeyInput, options: KeyReadOptions = {}): Promise<ParsedKey> {
    const text = checkInput(input).trim();
    const privateInput = /PRIVATE KEY-----/.test(text) || text.startsWith('PuTTY-User-Key-File-');
    const ppkVersion = /^PuTTY-User-Key-File-([23]):/.exec(text)?.[1];
    let format: KeyInfo['format'] = 'openssh';

    if (ppkVersion) {
        format = 'ppk';
    } else if (/^-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(text)) {
        format = 'pkcs8';
    } else if (text.startsWith('-----BEGIN RSA PRIVATE KEY-----') || text.startsWith('-----BEGIN RSA PUBLIC KEY-----')) {
        format = 'pkcs1';
    } else if (text.startsWith('-----BEGIN EC PRIVATE KEY-----')) {
        format = 'sec1';
    } else if (text.startsWith('-----BEGIN DSA PRIVATE KEY-----')) {
        format = 'pem';
    } else if (text.startsWith('-----BEGIN PUBLIC KEY-----')) {
        format = 'spki';
    } else if (text.startsWith('---- BEGIN SSH2 PUBLIC KEY ----')) {
        format = 'rfc4716';
    }

    const encrypted = /^Encryption: (?!none\s*$).+/m.test(text) ||
        text.startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----') ||
        /Proc-Type: 4,ENCRYPTED/.test(text) ||
        text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----') && openSshEncrypted(text);

    if (encrypted && options.inputPassphrase === undefined) {
        throw new SshPrivateKeyError('passphrase-required', 'This private key requires a passphrase.');
    }

    try {
        let key: sshpk.Key | sshpk.PrivateKey;

        if (privateInput) {
            let decoded: Buffer | undefined;

            try {
                if (format === 'ppk' || text.startsWith('PuTTY-User-Key-File-')) {
                    decoded = await readPpk(input, options.inputPassphrase);
                    key = sshpk.parsePrivateKey(decoded, 'ssh-private');
                } else if (format === 'openssh') {
                    const expectedPublic = checkKdfLimits(text);

                    key = sshpk.parsePrivateKey(text, 'ssh-private', {passphrase: options.inputPassphrase});

                    if (!(key as sshpk.PrivateKey).toPublic().toBuffer('rfc4253').equals(expectedPublic!)) {
                        throw new SshPrivateKeyError('integrity', 'The OpenSSH public and private sections do not match.');
                    }
                } else {
                    checkKdfLimits(text);

                    const native = createPrivateKey({key: text, format: 'pem', passphrase: options.inputPassphrase});

                    decoded = Buffer.from(native.export({format: 'pem', type: 'pkcs8'}) as string);
                    key = sshpk.parsePrivateKey(decoded, 'pkcs8');
                }

                validatePrivateKey(key as sshpk.PrivateKey);
            } finally {
                decoded?.fill(0);
            }
        } else {
            key = format === 'rfc4716' ? readRfc4716(text) : sshpk.parseKey(text, 'auto');
        }

        validateAlgorithm(key);

        return {
            key,
            format,
            encrypted,
            private: privateInput,
            ...(ppkVersion ? {ppkVersion: Number(ppkVersion) as 2 | 3} : {}),
        };
    } catch (error) {
        if (error instanceof SshPrivateKeyError) {
            throw error;
        }

        throw new SshPrivateKeyError(
            encrypted ? 'integrity' : 'format',
            encrypted ? 'The key could not be decrypted or verified.' : 'The key is malformed or unsupported.',
        );
    }
}

function openSshEncrypted(text: string): boolean {
    // Inspect only the cipher name here; full structural and KDF validation precedes parsing.
    const body = text.split(/\r?\n/).slice(1, -1).join('');
    const bytes = strictBase64(body);
    const magicLength = Buffer.byteLength('openssh-key-v1\0');

    if (bytes.length < magicLength + 4) {
        throw new SshPrivateKeyError('format', 'The OpenSSH private key is malformed.');
    }

    const size = bytes.readUInt32BE(magicLength);

    if (size > bytes.length - magicLength - 4) {
        throw new SshPrivateKeyError('format', 'The OpenSSH private key is malformed.');
    }

    return bytes.subarray(magicLength + 4, magicLength + 4 + size).toString() !== 'none';
}
