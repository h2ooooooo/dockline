import {convertPublicKey} from '@jalsoedesign/dockline-keys';

async function extractPublicKey(keyContents, passphrase) {
    return convertPublicKey(keyContents, {
        format: 'openssh',
        inputPassphrase: passphrase,
    });
}

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const publicKey = await extractPublicKey(keyContents);

console.log('OpenSSH public key:', publicKey.toString('utf8').startsWith('ssh-ed25519 '));
