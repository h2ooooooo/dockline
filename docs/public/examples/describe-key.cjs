const {inspectKey, fingerprintKey} = require('@jalsoedesign/dockline-keys');

async function main() {
    async function describeKey(keyContents, passphrase) {
        const info = await inspectKey(keyContents, {inputPassphrase: passphrase});
        const fingerprint = await fingerprintKey(keyContents, {inputPassphrase: passphrase});

        return {info, fingerprint};
    }

    const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
    const {info, fingerprint} = await describeKey(keyContents);

    console.log('Algorithm:', info.algorithm);
    console.log('SHA256 fingerprint:', fingerprint.startsWith('SHA256:'));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
