# Public SSH test identity

These are deliberately public test credentials used only by isolated loopback tests. The private-key passphrase is `fixture-passphrase`. Never use this identity outside tests.

The fixed Ed25519 pair keeps algorithm coverage deterministic. Dynamic fixture identities use RSA because the installed SSH dependency can shorten a newly generated Ed25519 public key when its first key byte is zero. No dependency source is modified.
