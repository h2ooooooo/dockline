# Supported key formats

Input is detected from key contents, not the filename. Public and private operations have separate output format choices.

## Import and export

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

Continue with [conversion](/keys/convert), [encryption](/keys/encryption) or [API limits](/keys/reference#bounds-and-validation).
