# Public local test credentials

The certificate and private key in this directory are deliberately public test fixtures for isolated loopback FTPS servers. They are valid for localhost and 127.0.0.1 from 2025-01-01 through 2036-01-01. They must never be used outside automated local tests. Tests explicitly trust this certificate only for their temporary server and verify that the default trust store rejects it.
