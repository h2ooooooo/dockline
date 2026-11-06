# Extract and convert public keys

`convertPublicKey` extracts the public portion of supported private input, or converts existing public input. It returns a Buffer; it does not write an authorized_keys file or modify a server.

Install `@jalsoedesign/dockline-keys`, then save `extract-public-key.ts` or the filename in the selected tab. This complete example uses the public-only sample key; it needs no server or key file.

Download: <a href="/examples/extract-public-key.ts" download="extract-public-key.ts">TypeScript</a> · <a href="/examples/extract-public-key.js" download="extract-public-key.js">JavaScript</a> · <a href="/examples/extract-public-key.mjs" download="extract-public-key.mjs">MJS</a> · <a href="/examples/extract-public-key.cjs" download="extract-public-key.cjs">CommonJS</a>

::: code-group

```ts [TypeScript]
// extract-public-key.ts
import {convertPublicKey, type KeyInput} from '@jalsoedesign/dockline-keys';

async function extractPublicKey(keyContents: KeyInput, passphrase?: string) {
    return convertPublicKey(keyContents, {
        format: 'openssh',
        inputPassphrase: passphrase,
    });
}

const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
const publicKey = await extractPublicKey(keyContents);

console.log('OpenSSH public key:', publicKey.toString('utf8').startsWith('ssh-ed25519 '));
```

```js [JavaScript]
// extract-public-key.js
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
```

```js [MJS]
// extract-public-key.mjs
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
```

```js [CommonJS]
// extract-public-key.cjs
const {convertPublicKey} = require('@jalsoedesign/dockline-keys');

async function main() {
    async function extractPublicKey(keyContents, passphrase) {
        return convertPublicKey(keyContents, {
            format: 'openssh',
            inputPassphrase: passphrase,
        });
    }

    const keyContents = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHSfk0iVuoJjZcokMlnUBsZMppVQ/KGDxV8Jb7lF8qo documentation@example';
    const publicKey = await extractPublicKey(keyContents);

    console.log('OpenSSH public key:', publicKey.toString('utf8').startsWith('ssh-ed25519 '));
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
npx tsx extract-public-key.ts
```

```sh [JavaScript]
npm pkg set type=module
node extract-public-key.js
```

```sh [MJS]
node extract-public-key.mjs
```

```sh [CommonJS]
node extract-public-key.cjs
```

:::

## Output

```text
OpenSSH public key: true
```

For encrypted private input, supply the input passphrase. Public input needs no private-key passphrase. The output formats are `openssh`, `rfc4716`, `spki` and RSA-only `pkcs1`. See [formats](/keys/formats).

Decode the returned Buffer as UTF-8 when displaying or saving a textual public-key representation. Keep private buffers out of logs; returning a public key does not authorize publishing other input metadata.
