import {randomBytes} from 'node:crypto';
import type sshpk from 'sshpk';
import {SshPrivateKeyError} from './errors.js';

export function validateAlgorithm(key: sshpk.Key | sshpk.PrivateKey): void {
    const maximumBits: Record<string, number> = {
        rsa: 16384,
        dsa: 4096,
        ecdsa: 521,
        ed25519: 256,
    };
    const maximum = maximumBits[key.type];

    if (!maximum) {
        throw new SshPrivateKeyError('unsupported', 'This key algorithm is unsupported.');
    }

    const maximumPartBytes = key.type === 'ecdsa' ? 134 : key.type === 'ed25519' ? 65 : maximum / 8 + 1;

    if (
        !Number.isSafeInteger(key.size) ||
        key.size <= 0 ||
        key.size > maximum ||
        key.parts.some(part => part.data.length > maximumPartBytes)
    ) {
        throw new SshPrivateKeyError('resource-limit', 'Key parameters exceed supported size limits.');
    }
}

export function validatePrivateKey(key: sshpk.PrivateKey): void {
    validateAlgorithm(key);

    const hash = key.type === 'ed25519' ? 'sha512' : 'sha256';
    const challenge = randomBytes(32);
    const signer = key.createSign(hash);
    const verifier = key.toPublic().createVerify(hash);

    signer.update(challenge);
    verifier.update(challenge);

    if (!verifier.verify(signer.sign())) {
        throw new SshPrivateKeyError('integrity', 'The public and private key parts do not match.');
    }
}
