# Read and save key files

File handling is optional application code. Dockline Keys accepts contents, so it also works with a vault, database or an in-memory key. Passing a filename string to `inspectKey` or `convertPrivateKey` does not open that file.

## Convert a file to encrypted OpenSSH

Place a supported key at `input.ppk`, set `INPUT_PASSPHRASE` if needed, and set a non-empty `OUTPUT_PASSPHRASE`. The original file is read, not changed. The destination is create-only; an existing `output.openssh` is refused.

::: code-group

```ts [TypeScript]
// convert-key-file.ts
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
```

```js [JavaScript]
// convert-key-file.js
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
```

```js [MJS]
// convert-key-file.mjs
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
```

```js [CommonJS]
// convert-key-file.cjs
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
```

:::

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx convert-key-file.ts
```

```sh [JavaScript]
npm pkg set type=module
node convert-key-file.js
```

```sh [MJS]
node convert-key-file.mjs
```

```sh [CommonJS]
node convert-key-file.cjs
```

:::

Successful output:

```text
Saved encrypted output.openssh.
```

The requested POSIX mode is owner read/write. On Windows, file access is governed by the destination's ACL; choose a private directory and manage its access policy. Keep exported private keys and passphrases out of source control.

This is the only introductory Keys recipe that needs filesystem imports. For conversion without disk access, use the [in-memory example](/keys/convert).
