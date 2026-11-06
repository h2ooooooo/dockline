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
