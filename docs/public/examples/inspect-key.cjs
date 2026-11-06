const {inspectKey} = require('@jalsoedesign/dockline-keys');

async function main() {
    const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
    const info = await inspectKey(keyContents);

    console.log('Kind:', info.kind);
    console.log('Format:', info.format);
    console.log('Algorithm:', info.algorithm);
    console.log('Encrypted:', info.encrypted);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
