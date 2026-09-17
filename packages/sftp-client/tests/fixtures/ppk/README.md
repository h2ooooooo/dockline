# Public test keys

These deliberately public SSHJ fixtures are from https://github.com/hierynomus/sshj/tree/243f339bcd85edf8ad3b6cf49b3fb26610c0d07d, under Apache-2.0 (see LICENSE.txt). Never use them for real accounts.

The v3_*.ppk fixtures are copied from PuTTYKeyFileTest.java. The encrypted RSA fixtures use passphrase changeit; the ECDSA fixture is unencrypted. rsa-reference.openssh is the upstream reference key. Other fixtures preserve upstream v2 key material, with v2 MAC verified, padding removed, and a new unencrypted v3 header and HMAC-SHA-256.
