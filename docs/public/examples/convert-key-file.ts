import {promises as fs} from 'node:fs';
import {convertPrivateKey} from '@jalsoedesign/dockline-keys';

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
