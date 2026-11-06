import {inspectKey, fingerprintKey, type KeyInput} from '@jalsoedesign/dockline-keys';

async function describeKey(keyContents: KeyInput, passphrase?: string) {
    const info = await inspectKey(keyContents, {inputPassphrase: passphrase});
    const fingerprint = await fingerprintKey(keyContents, {inputPassphrase: passphrase});

    return {info, fingerprint};
}

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const {info, fingerprint} = await describeKey(keyContents);

console.log('Algorithm:', info.algorithm);
console.log('SHA256 fingerprint:', fingerprint.startsWith('SHA256:'));
