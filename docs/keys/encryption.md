# Encryption and passphrases

`inputPassphrase` unlocks encrypted input. `outputPassphrase` encrypts the exported private key. They are separate options: supplying an input passphrase does not automatically encrypt the result.

## Change the passphrase

The conversion function returns encrypted OpenSSH contents. The complete example below generates a disposable key and proves that the new passphrase unlocks the same identity:

Install `@jalsoedesign/dockline-keys`, then save `change-passphrase.ts` or the filename in the selected tab. This complete example uses a generated disposable private key and demonstration passphrases; it needs no server or key file.

Download: <a href="/examples/change-passphrase.ts" download="change-passphrase.ts">TypeScript</a> · <a href="/examples/change-passphrase.js" download="change-passphrase.js">JavaScript</a> · <a href="/examples/change-passphrase.mjs" download="change-passphrase.mjs">MJS</a> · <a href="/examples/change-passphrase.cjs" download="change-passphrase.cjs">CommonJS</a>

::: code-group

```ts [TypeScript]
// change-passphrase.ts
import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, inspectKey, fingerprintKey, type KeyInput} from '@jalsoedesign/dockline-keys';

async function changePassphrase(keyContents: KeyInput, oldPassphrase: string, newPassphrase: string) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase: oldPassphrase,
        outputPassphrase: newPassphrase,
    });
}

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
});
const encrypted = await convertPrivateKey(privateKey, {
    format: 'openssh',
    outputPassphrase: 'disposable-old-passphrase',
});
const changed = await changePassphrase(encrypted, 'disposable-old-passphrase', 'disposable-new-passphrase');
const info = await inspectKey(changed, {inputPassphrase: 'disposable-new-passphrase'});

console.log('Encrypted:', info.encrypted);
console.log('Identity preserved:', await fingerprintKey(privateKey) === await fingerprintKey(changed, {inputPassphrase: 'disposable-new-passphrase'}));
```

```js [JavaScript]
// change-passphrase.js
import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, inspectKey, fingerprintKey} from '@jalsoedesign/dockline-keys';

async function changePassphrase(keyContents, oldPassphrase, newPassphrase) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase: oldPassphrase,
        outputPassphrase: newPassphrase,
    });
}

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
});
const encrypted = await convertPrivateKey(privateKey, {
    format: 'openssh',
    outputPassphrase: 'disposable-old-passphrase',
});
const changed = await changePassphrase(encrypted, 'disposable-old-passphrase', 'disposable-new-passphrase');
const info = await inspectKey(changed, {inputPassphrase: 'disposable-new-passphrase'});

console.log('Encrypted:', info.encrypted);
console.log('Identity preserved:', await fingerprintKey(privateKey) === await fingerprintKey(changed, {inputPassphrase: 'disposable-new-passphrase'}));
```

```js [MJS]
// change-passphrase.mjs
import {generateKeyPairSync} from 'node:crypto';
import {convertPrivateKey, inspectKey, fingerprintKey} from '@jalsoedesign/dockline-keys';

async function changePassphrase(keyContents, oldPassphrase, newPassphrase) {
    return convertPrivateKey(keyContents, {
        format: 'openssh',
        inputPassphrase: oldPassphrase,
        outputPassphrase: newPassphrase,
    });
}

const {privateKey} = generateKeyPairSync('ed25519', {
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
});
const encrypted = await convertPrivateKey(privateKey, {
    format: 'openssh',
    outputPassphrase: 'disposable-old-passphrase',
});
const changed = await changePassphrase(encrypted, 'disposable-old-passphrase', 'disposable-new-passphrase');
const info = await inspectKey(changed, {inputPassphrase: 'disposable-new-passphrase'});

console.log('Encrypted:', info.encrypted);
console.log('Identity preserved:', await fingerprintKey(privateKey) === await fingerprintKey(changed, {inputPassphrase: 'disposable-new-passphrase'}));
```

```js [CommonJS]
// change-passphrase.cjs
const {generateKeyPairSync} = require('node:crypto');
const {convertPrivateKey, inspectKey, fingerprintKey} = require('@jalsoedesign/dockline-keys');

async function main() {
    async function changePassphrase(keyContents, oldPassphrase, newPassphrase) {
        return convertPrivateKey(keyContents, {
            format: 'openssh',
            inputPassphrase: oldPassphrase,
            outputPassphrase: newPassphrase,
        });
    }

    const {privateKey} = generateKeyPairSync('ed25519', {
        privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
        publicKeyEncoding: {format: 'pem', type: 'spki'},
    });
    const encrypted = await convertPrivateKey(privateKey, {
        format: 'openssh',
        outputPassphrase: 'disposable-old-passphrase',
    });
    const changed = await changePassphrase(encrypted, 'disposable-old-passphrase', 'disposable-new-passphrase');
    const info = await inspectKey(changed, {inputPassphrase: 'disposable-new-passphrase'});

    console.log('Encrypted:', info.encrypted);
    console.log('Identity preserved:', await fingerprintKey(privateKey) === await fingerprintKey(changed, {inputPassphrase: 'disposable-new-passphrase'}));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
```

:::

## Run the example

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx change-passphrase.ts
```

```sh [JavaScript]
npm pkg set type=module
node change-passphrase.js
```

```sh [MJS]
node change-passphrase.mjs
```

```sh [CommonJS]
node change-passphrase.cjs
```

:::

## Output

```text
Encrypted: true
Identity preserved: true
```

The original input is not changed. This also converts other supported input formats to OpenSSH; choose a matching output format when you want to keep that format. To change a key's comment, use the supported `comment` export option.

## Select an export deliberately

| Intention | Options |
| --- | --- |
| Read encrypted input | `inputPassphrase` |
| Export encrypted contents | `outputPassphrase` plus the chosen format |
| Change encryption/passphrase | Supply both passphrases |
| Export unencrypted contents | Omit `outputPassphrase`; protect any resulting private data |

Do not log converted private buffers or embed real passphrases in source. The [complete disposable conversion](/keys/convert#run-a-complete-conversion) proves encrypted exports without touching your own keys. [File recipes](/keys/files) keep disk I/O separate from conversion.

Wrong/missing passphrases, tampered keys, unsupported formats and excessive KDF parameters produce typed errors. See [error reasons and limits](/keys/reference#errors).
