import {createCipheriv, createHash, randomBytes} from 'node:crypto';
import {pemBytes} from './limits.js';

/** Traditional OpenSSL PEM uses EVP_BytesToKey; PKCS#8 is the preferred general-purpose encrypted export. */
export function encryptTraditionalPem(pem: Buffer, passphrase: string | Buffer): Buffer {
    const password = Buffer.from(passphrase);
    const iv = randomBytes(16);
    const salt = iv.subarray(0, 8);
    const chunks: Buffer[] = [];
    let previous: Buffer = Buffer.alloc(0);
    let derived: Buffer = Buffer.alloc(0);
    const text = pem.toString();
    const header = /^-----BEGIN ([A-Z ]+)-----/.exec(text)![1];
    const plain = pemBytes(text);

    try {
        while (Buffer.concat(chunks).length < 32) {
            previous = createHash('md5').update(previous).update(password).update(salt).digest();
            chunks.push(previous);
        }

        derived = Buffer.concat(chunks);

        const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), iv);
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        const body = encrypted.toString('base64').match(/.{1,64}/g)!.join('\n');

        return Buffer.from('-----BEGIN ' + header + '-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,' +
            iv.toString('hex').toUpperCase() + '\n\n' + body + '\n-----END ' + header + '-----\n');
    } finally {
        password.fill(0);
        plain.fill(0);
        derived.fill(0);
        chunks.forEach(chunk => chunk.fill(0));
    }
}
