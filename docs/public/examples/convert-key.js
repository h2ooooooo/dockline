import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, fingerprintKey, inspectKey} from '@jalsoedesign/dockline-keys';

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
});

const ppk = await convertPrivateKey(privateKey, {
    format: 'ppk',
    outputPassphrase: 'demo-input-passphrase',
});
const openssh = await convertPrivateKey(ppk, {
    format: 'openssh',
    inputPassphrase: 'demo-input-passphrase',
    outputPassphrase: 'demo-output-passphrase',
});
const ppkInfo = await inspectKey(ppk, {inputPassphrase: 'demo-input-passphrase'});
const opensshInfo = await inspectKey(openssh, {inputPassphrase: 'demo-output-passphrase'});
const originalFingerprint = await fingerprintKey(privateKey);

console.log('PPK encrypted:', ppkInfo.encrypted);
console.log('OpenSSH encrypted:', opensshInfo.encrypted);
console.log('Identity preserved:', opensshInfo.fingerprint === originalFingerprint);
