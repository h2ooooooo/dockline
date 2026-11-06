# @jalsoedesign/dockline-keys

Independent SSH key inspection and conversion. No SSH/SFTP client, network connection, external executable or filesystem access is required.

Build this standalone workspace locally with `npm run build --workspace @jalsoedesign/dockline-keys`.

## Encrypted conversion

```ts
import {convertPrivateKey, convertPublicKey, inspectKey} from '@jalsoedesign/dockline-keys';

export async function convertPpk(key: Buffer, inputPassphrase: string, outputPassphrase: string) {
    const info = await inspectKey(key, {inputPassphrase});
    const openssh = await convertPrivateKey(key, {
        format: 'openssh',
        inputPassphrase,
        outputPassphrase,
    });
    const publicKey = await convertPublicKey(key, {
        format: 'openssh',
        inputPassphrase,
    });

    return {info, openssh, publicKey};
}
```

The example uses encrypted PPK input and produces an encrypted OpenSSH private key plus a public key. All operations return buffers in memory. The caller owns any file writes and their permissions.

Input format is detected from contents. `inputPassphrase` unlocks the input; `outputPassphrase` encrypts the output. Omitting `outputPassphrase` produces an unencrypted private key. Converting to the same format with a different output passphrase changes encryption without changing the key pair.

## Formats

| API / format | Support |
| --- | --- |
| Private `openssh` | Modern OpenSSH, unencrypted or bcrypt/AES-encrypted; output uses AES-256-CTR |
| Private `ppk` | PuTTY PPK v2/v3, unencrypted or AES-256-CBC-encrypted; output defaults to v3 with Argon2id |
| Private `pkcs8` | PKCS#8 PEM, unencrypted or PBES2/PBKDF2-encrypted; encrypted output uses AES-256-CBC |
| Private `pem` | Traditional RSA, EC or DSA PEM; optional traditional OpenSSL AES-256-CBC encryption |
| Private `pkcs1` | Explicit traditional RSA PEM |
| Private `sec1` | Explicit traditional EC PEM |
| Public `openssh` | SSH single-line public keys |
| Public `rfc4716` | SSH2 public keys, including continued Comment headers |
| Public `spki` | PEM SubjectPublicKeyInfo |
| Public `pkcs1` | RSA PEM public keys |

RSA, Ed25519, ECDSA nistp256/nistp384/nistp521 and legacy DSA are supported. Ed25519 has no traditional PEM export; use OpenSSH, PPK or PKCS#8. DER, SSH certificates and hardware-backed keys are outside this release.

PPK v2 is an explicit compatibility export, selected with `ppkVersion: 2`. Modern PPK output defaults to v3. PPK v3 imports support Argon2d, Argon2i and Argon2id. Export parameters can be configured through `argon2: {memoryKiB, passes, parallelism}`; defaults are 65536 KiB, three passes and one lane. PPK v2 uses its specified legacy SHA-1 derivation and MAC.

Comments survive OpenSSH, PPK and RFC4716 conversions. PEM formats do not provide a corresponding SSH comment field.

## Inspection and fingerprints

- `inspectKey(input, {inputPassphrase?})` returns format, kind, algorithm, size, encryption state, comment, SHA-256 fingerprint and optional PPK version.
- `fingerprintKey(input, options?)` returns the OpenSSH-style SHA-256 public-key fingerprint.
- `convertPublicKey` extracts the public key from private input or converts existing public input.
- Private-key inspection/extraction requires a passphrase when input is encrypted and verifies the key before returning metadata.
- Converting a file format preserves the key pair. It does not change an RSA key into an Ed25519 key.

## Bounds and validation

Inputs are limited to 1 MiB. RSA is limited to 16384 bits and DSA to 4096 bits; ECDSA is limited to the named NIST curves and Ed25519 to its fixed size. Individual components are also bounded before private-key signing validation.

PPK Argon2 imports/exports are bounded to 256 MiB, 100 passes and 16 lanes. OpenSSH bcrypt imports are limited to 128 rounds. Encrypted PKCS#8 imports support PBES2/PBKDF2 with at most one million iterations. Unsupported KDFs and excessive parameters fail before their derivation runs.

PPK MACs are verified before use. Public/private consistency is checked by signing and verifying a challenge; OpenSSH's outer public section must match its private section. Errors do not include private material or passphrases. Temporary owned buffers are cleared where practical; JavaScript strings, library internals and garbage collection do not provide a complete secure-memory-erasure guarantee.

`SshPrivateKeyError.reason` is one of `passphrase-required`, `integrity`, `format`, `unsupported` or `resource-limit`. It continues to extend Dockline's `CredentialProviderError`.

## Transport compatibility

`preparePrivateKey(key, passphrase?)` normalizes supported private-key formats into unencrypted OpenSSH contents for an SSH transport. It does not write decrypted contents to a file.

The existing `prepareSshPrivateKey` API remains available from both this package and `dockline-sftp-client`: PPK v3 is verified and converted, while all other inputs retain their original pass-through identity. `undefined` remains `undefined`. SFTP re-exports the same `SshPrivateKeyError` class and failure type.

Dockline SSH and SFTP use `preparePrivateKey` for authentication. Transfer behavior and application-owned host trust remain separate.

## Implementation and interoperability

Standard SSH/PEM structures use [sshpk](https://github.com/TritonDataCenter/node-sshpk) and Node crypto. PPK follows [PuTTY Appendix C](https://www.puttyssh.org/0.83/htmldoc/AppendixC.html), using hash-wasm for Argon2. OpenSSH encoding follows [PROTOCOL.key](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key). RFC4716 public keys follow [RFC 4716](https://www.rfc-editor.org/rfc/rfc4716).

Tests cover native-crypto identity, independently generated PuTTY fixtures, SSH transport parsing, an encrypted export read by ssh-keygen when installed, wrong passphrases, tampering, resource bounds and local SSH/SFTP authentication. No personal keys or credential stores are used.
