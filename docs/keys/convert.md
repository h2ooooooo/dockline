# Convert private keys

Convert supported private-key contents between PPK, modern OpenSSH and supported PEM formats. Input format is detected from contents. The `format` option selects the output; the returned Buffer contains the converted key.

## Convert PPK to encrypted OpenSSH

This reusable function is a recipe, not a separate command. Pass existing key contents and the required passphrases; it returns a Buffer and prints nothing. For a complete executable program with matching language/run tabs and output, use [the conversion example below](#run-a-complete-conversion):

::: code-group

```ts [TypeScript]
import {convertPrivateKey, type KeyInput} from '@jalsoedesign/dockline-keys';

async function ppkToOpenSsh(keyContents: KeyInput, inputPassphrase: string, outputPassphrase: string) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase,
        outputPassphrase,
    });
}
```

```js [JavaScript]
import {convertPrivateKey} from '@jalsoedesign/dockline-keys';

async function ppkToOpenSsh(keyContents, inputPassphrase, outputPassphrase) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase,
        outputPassphrase,
    });
}
```

```js [MJS]
import {convertPrivateKey} from '@jalsoedesign/dockline-keys';

async function ppkToOpenSsh(keyContents, inputPassphrase, outputPassphrase) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase,
        outputPassphrase,
    });
}
```

```js [CommonJS]
const {convertPrivateKey} = require('@jalsoedesign/dockline-keys');

async function ppkToOpenSsh(keyContents, inputPassphrase, outputPassphrase) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase,
        outputPassphrase,
    });
}
```

:::

For OpenSSH → PPK, use `format: 'ppk'` with the same input/output passphrase distinction. PPK output defaults to v3. See [format compatibility](/keys/formats) for algorithm-specific export restrictions.

## Run a complete conversion

This program generates a disposable Ed25519 key, exports encrypted PPK, converts it to encrypted OpenSSH and checks its identity. No private bytes are printed and no files are written. The fixed passphrases are for this disposable demo only; real applications supply secrets at runtime.

::: code-group

```ts [TypeScript]
// convert-key.ts
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
```

```js [JavaScript]
// convert-key.js
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
```

```js [MJS]
// convert-key.mjs
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
```

```js [CommonJS]
// convert-key.cjs
const {generateKeyPairSync} = require('node:crypto');
const {convertPrivateKey, fingerprintKey, inspectKey} = require('@jalsoedesign/dockline-keys');

async function main() {
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
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

Run the selected format:

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx convert-key.ts
```

```sh [JavaScript]
npm pkg set type=module
node convert-key.js
```

```sh [MJS]
node convert-key.mjs
```

```sh [CommonJS]
node convert-key.cjs
```

:::

Output:

```text
PPK encrypted: true
OpenSSH encrypted: true
Identity preserved: true
```

Converting formats preserves the key pair; it does not change RSA into Ed25519. Omitting `outputPassphrase` requests unencrypted output. Read [encryption choices](/keys/encryption) before exporting an existing private key.
