const {promises: fs} = require('node:fs');
const {convertPrivateKey} = require('@jalsoedesign/dockline-keys');

async function main() {
    const outputPassphrase = process.env.OUTPUT_PASSPHRASE;

    if (!outputPassphrase) {
        throw new Error('Set OUTPUT_PASSPHRASE before exporting an encrypted key.');
    }

    const keyContents = await fs.readFile('./input.ppk');
    const converted = await convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase: process.env.INPUT_PASSPHRASE,
        outputPassphrase,
    });

    await fs.writeFile('./output.openssh', converted, {flag: 'wx', mode: 0o600});
    console.log('Saved encrypted output.openssh.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
