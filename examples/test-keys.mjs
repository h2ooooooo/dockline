import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, inspectKey, fingerprintKey} from '@jalsoedesign/dockline-keys';

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
});
const fingerprint = await fingerprintKey(privateKey);
const ppk = await convertPrivateKey(privateKey, {format: 'ppk', outputPassphrase: 'demo-only'});
const ppkInfo = await inspectKey(ppk, {inputPassphrase: 'demo-only'});

assert.equal(ppkInfo.encrypted, true);
assert.equal(ppkInfo.fingerprint, fingerprint);
console.log('Generated a disposable Ed25519 key in memory.');
console.log('PKCS#8 -> encrypted PPK v3: identity verified.');

const openssh = await convertPrivateKey(ppk, {
    format: 'openssh',
    inputPassphrase: 'demo-only',
    outputPassphrase: 'another-demo-passphrase',
});
const info = await inspectKey(openssh, {inputPassphrase: 'another-demo-passphrase'});

assert.equal(info.encrypted, true);
assert.equal(info.fingerprint, fingerprint);
await assert.rejects(() => inspectKey(openssh, {inputPassphrase: 'wrong'}));
console.log('Encrypted PPK -> encrypted OpenSSH: identity verified.');
console.log('Wrong passphrase rejected.');
console.log('PASS: bidirectional conversion and encrypted exports. No key files written.');
