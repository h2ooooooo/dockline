# Inspect your first key

Install one package and inspect a public key in memory. This example needs no key file, credentials or server. The sample is a public Ed25519 key; it contains no private key material.

## Install

```sh
npm install @jalsoedesign/dockline-keys
```

## Save the example

Choose a tab and save its filename. TypeScript is the default. Download: <a href="/examples/inspect-key.ts" download="inspect-key.ts">TypeScript</a> · <a href="/examples/inspect-key.js" download="inspect-key.js">JavaScript</a> · <a href="/examples/inspect-key.mjs" download="inspect-key.mjs">MJS</a> · <a href="/examples/inspect-key.cjs" download="inspect-key.cjs">CommonJS</a>.

::: code-group

```ts [TypeScript]
// inspect-key.ts
import {inspectKey, type KeyInfo} from '@jalsoedesign/dockline-keys';

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const info: KeyInfo = await inspectKey(keyContents);

console.log('Kind:', info.kind);
console.log('Format:', info.format);
console.log('Algorithm:', info.algorithm);
console.log('Encrypted:', info.encrypted);
```

```js [JavaScript]
// inspect-key.js
import {inspectKey} from '@jalsoedesign/dockline-keys';

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const info = await inspectKey(keyContents);

console.log('Kind:', info.kind);
console.log('Format:', info.format);
console.log('Algorithm:', info.algorithm);
console.log('Encrypted:', info.encrypted);
```

```js [MJS]
// inspect-key.mjs
import {inspectKey} from '@jalsoedesign/dockline-keys';

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const info = await inspectKey(keyContents);

console.log('Kind:', info.kind);
console.log('Format:', info.format);
console.log('Algorithm:', info.algorithm);
console.log('Encrypted:', info.encrypted);
```

```js [CommonJS]
// inspect-key.cjs
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
```

:::

## Run

::: code-group

```sh [TypeScript]
npm install --save-dev typescript tsx @types/node
npm pkg set type=module
npx tsx inspect-key.ts
```

```sh [JavaScript]
npm pkg set type=module
node inspect-key.js
```

```sh [MJS]
node inspect-key.mjs
```

```sh [CommonJS]
node inspect-key.cjs
```

:::

## Output

```text
Kind: public
Format: openssh
Algorithm: ed25519
Encrypted: false
```

`inspectKey` returns metadata; the example prints these four fields. A public key is not encrypted private input. The same API can inspect a private key, including supported encrypted input when you supply its passphrase.

Next: [fingerprints and inspection](/keys/inspect), [try encrypted conversion](/keys/convert#run-a-complete-conversion), or [read a file](/keys/files).
