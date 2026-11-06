import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, inspectKey, fingerprintKey, type KeyInput} from '@jalsoedesign/dockline-keys';

async function changePassphrase(keyContents: KeyInput, oldPassphrase: string, newPassphrase: string) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase: oldPassphrase,
        outputPassphrase: newPassphrase,
    });
}

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
});
const encrypted = await convertPrivateKey(privateKey, {
    format: 'openssh',
    outputPassphrase: 'disposable-old-passphrase',
});
const changed = await changePassphrase(encrypted, 'disposable-old-passphrase', 'disposable-new-passphrase');
const info = await inspectKey(changed, {inputPassphrase: 'disposable-new-passphrase'});

console.log('Encrypted:', info.encrypted);
console.log('Identity preserved:', await fingerprintKey(privateKey) === await fingerprintKey(changed, {inputPassphrase: 'disposable-new-passphrase'}));
