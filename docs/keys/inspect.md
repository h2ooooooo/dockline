# Inspect a key and its fingerprint

Use `inspectKey` to identify supported public/private key contents. Use `fingerprintKey` when you only need the OpenSSH-style SHA-256 public identity. Neither function opens a connection or prints the input.

## Inspect key contents

This reusable function accepts a string or Buffer containing key data. To try a complete program first, use the [quick start](/keys/quick-start).

Install `@jalsoedesign/dockline-keys`, then save `describe-key.ts` or the filename in the selected tab. This complete example uses the public-only sample key; it needs no server or key file.

Download: <a href="/examples/describe-key.ts" download="describe-key.ts">TypeScript</a> · <a href="/examples/describe-key.js" download="describe-key.js">JavaScript</a> · <a href="/examples/describe-key.mjs" download="describe-key.mjs">MJS</a> · <a href="/examples/describe-key.cjs" download="describe-key.cjs">CommonJS</a>

::: code-group

```ts [TypeScript]
// describe-key.ts
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
```

```js [JavaScript]
// describe-key.js
import {inspectKey, fingerprintKey} from '@jalsoedesign/dockline-keys';

async function describeKey(keyContents, passphrase) {
    const info = await inspectKey(keyContents, {inputPassphrase: passphrase});
    const fingerprint = await fingerprintKey(keyContents, {inputPassphrase: passphrase});

    return {info, fingerprint};
}

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const {info, fingerprint} = await describeKey(keyContents);

console.log('Algorithm:', info.algorithm);
console.log('SHA256 fingerprint:', fingerprint.startsWith('SHA256:'));
```

```js [MJS]
// describe-key.mjs
import {inspectKey, fingerprintKey} from '@jalsoedesign/dockline-keys';

async function describeKey(keyContents, passphrase) {
    const info = await inspectKey(keyContents, {inputPassphrase: passphrase});
    const fingerprint = await fingerprintKey(keyContents, {inputPassphrase: passphrase});

    return {info, fingerprint};
}

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const {info, fingerprint} = await describeKey(keyContents);

console.log('Algorithm:', info.algorithm);
console.log('SHA256 fingerprint:', fingerprint.startsWith('SHA256:'));
```

```js [CommonJS]
// describe-key.cjs
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
```

:::

## Run the example

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx describe-key.ts
```

```sh [JavaScript]
npm pkg set type=module
node describe-key.js
```

```sh [MJS]
node describe-key.mjs
```

```sh [CommonJS]
node describe-key.cjs
```

:::

## Output

```text
Algorithm: ed25519
SHA256 fingerprint: true
```

The result contains format, public/private kind, algorithm, bit size, encryption state, comment, fingerprint and a PPK version when applicable. The fingerprint describes the public identity, so converting a private key's format does not change it.

Encrypted private input requires `inputPassphrase`; inspection verifies/decrypts supported input rather than guessing from a filename. Public-key inspection does not reveal or recover a private key. See [supported formats](/keys/formats) and [errors](/keys/reference#errors).
