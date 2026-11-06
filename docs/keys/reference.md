# Keys API reference

Import runtime functions and types from `@jalsoedesign/dockline-keys`. `KeyInput` is a string or Buffer containing key data. Paths are handled separately in [file recipes](/keys/files).

| Function | Result |
| --- | --- |
| `inspectKey(input, options?)` | `Promise<KeyInfo>` |
| `fingerprintKey(input, options?)` | `Promise<string>`, OpenSSH-style SHA-256 fingerprint |
| `convertPrivateKey(input, options)` | `Promise<Buffer>`, converted private contents |
| `convertPublicKey(input, options)` | `Promise<Buffer>`, extracted/converted public contents |
| `preparePrivateKey(input, passphrase?)` | Supported private contents normalized for a transport, or undefined |
| `prepareSshPrivateKey(input, passphrase?)` | Compatibility reader described below |

## Options and metadata

These are TypeScript contracts rather than runnable examples:

```ts
export type KeyInput = string | Buffer;
export type PrivateKeyFormat = 'openssh' | 'ppk' | 'pkcs8' | 'pem' | 'pkcs1' | 'sec1';
export type PublicKeyFormat = 'openssh' | 'rfc4716' | 'spki' | 'pkcs1';

export interface KeyReadOptions {
    inputPassphrase?: string | Buffer;
}

export interface PpkDerivationOptions {
    memoryKiB?: number;
    passes?: number;
    parallelism?: number;
}

export interface PrivateKeyExportOptions extends KeyReadOptions {
    format: PrivateKeyFormat;
    outputPassphrase?: string | Buffer;
    ppkVersion?: 2 | 3;
    comment?: string;
    argon2?: PpkDerivationOptions;
}

export interface PublicKeyExportOptions extends KeyReadOptions {
    format: PublicKeyFormat;
    comment?: string;
}

export interface KeyInfo {
    kind: 'private' | 'public';
    format: PrivateKeyFormat | PublicKeyFormat;
    algorithm: 'rsa' | 'dsa' | 'ecdsa' | 'ed25519';
    bits: number;
    encrypted: boolean;
    comment: string;
    fingerprint: string;
    ppkVersion?: 2 | 3;
}
```

## Errors

`SshPrivateKeyError` extends the shared `CredentialProviderError`. Its `reason` is `passphrase-required`, `integrity`, `format`, `unsupported` or `resource-limit`. Errors do not include the private input or passphrase.

## Bounds and validation

Inputs are limited to 1 MiB. RSA is limited to 16384 bits and DSA to 4096 bits; ECDSA is limited to the named NIST curves and Ed25519 to its fixed size. Individual components are also bounded before private-key signing validation.

PPK Argon2 imports/exports are bounded to 256 MiB, 100 passes and 16 lanes. OpenSSH bcrypt imports are limited to 128 rounds. Encrypted PKCS#8 imports support PBES2/PBKDF2 with at most one million iterations. Unsupported KDFs and excessive parameters fail before their derivation runs.

PPK MACs are verified before use. Public/private consistency is checked by signing and verifying a challenge; OpenSSH's outer public section must match its private section. Errors do not include private material or passphrases. Temporary owned buffers are cleared where practical; JavaScript strings, library internals and garbage collection do not provide a complete secure-memory-erasure guarantee.

`SshPrivateKeyError.reason` is one of `passphrase-required`, `integrity`, `format`, `unsupported` or `resource-limit`. It continues to extend Dockline's `CredentialProviderError`.

## Transport compatibility

`preparePrivateKey(key, passphrase?)` normalizes supported private-key formats into unencrypted OpenSSH contents for an SSH transport. It does not write decrypted contents to a file.

The existing `prepareSshPrivateKey` API remains available from both this package and `dockline-sftp-client`: PPK v3 is verified and converted, while all other inputs retain their original pass-through identity. `undefined` remains `undefined`. SFTP re-exports the same `SshPrivateKeyError` class and failure type.

Dockline SSH and SFTP use `preparePrivateKey` for authentication. Transfer behavior and application-owned host trust remain separate.

For format-specific output ciphers and supported algorithms see [formats](/keys/formats). Key conversion does not change the key pair or create an authenticated connection.
