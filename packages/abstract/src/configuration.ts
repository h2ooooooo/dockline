import type {ConnectionOptions} from 'node:tls';
import type {ConnectorConnectionOptions} from './connection-options.js';
import type {ConnectorOperationOptions} from './operation-options.js';
import {UnsupportedProtocolError} from './errors.js';

export interface FtpFilenameEncodingOptions {
    charset: string;
    onUnrepresentable?: 'reject';
}

export type FtpFilenameEncoding = 'utf8' | 'ascii' | 'latin1';

export interface FtpConnectorConfig extends ConnectorOperationOptions, ConnectorConnectionOptions {
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean | 'implicit';
    initialPath: string;
    passive: boolean | null;
    secureOptions?: ConnectionOptions;
    filenameEncoding?: FtpFilenameEncodingOptions;
}

export interface SftpHostKeyChallenge {
    readonly host: string;
    readonly port: number;
    readonly keyType: string;
    /** OpenSSH-style SHA256 fingerprint without base64 padding. */
    readonly fingerprint: string;
    /** SSH wire-format public key, not a private authentication key. */
    readonly publicKey: Buffer;
    readonly previousFingerprint?: string;
    readonly changed: boolean;
    /** Cancel pending UI work when this connection attempt is abandoned. */
    readonly abortSignal: AbortSignal;
}

export type SftpTrustPolicy = (challenge: SftpHostKeyChallenge) => boolean | Promise<boolean>;
export type SftpHostVerifier =
    ((key: Buffer) => boolean | Promise<boolean>) |
    ((key: Buffer, verify: (accepted: boolean) => void) => void);

export interface SftpKeyboardInteractiveChallenge {
    readonly name: string;
    readonly instructions: string;
    readonly language: string;
    readonly prompts: readonly {readonly prompt: string; readonly echo: boolean}[];
    readonly abortSignal: AbortSignal;
}

export type SftpKeyboardInteractive = string | ((challenge: SftpKeyboardInteractiveChallenge) =>
    readonly string[] | Promise<readonly string[]>);

export interface SftpConnectorConfig extends ConnectorOperationOptions, ConnectorConnectionOptions {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string | Buffer;
    privateKeyPath?: string;
    passphrase?: string;
    initialPath: string;
    /** POSIX socket, Windows OpenSSH named pipe, Cygwin socket, or 'pageant'. No automatic discovery. */
    agent?: string;
    /** Forwarding is deliberately unsupported; authentication never exposes the agent to the server. */
    agentForward?: false;
    /** A string answers a single prompt; multi-prompt exchanges require the callback. */
    keyboardInteractive?: SftpKeyboardInteractive;
    /** SFTP supports UTF-8 filenames only. File-content bytes are never transcoded. */
    filenameEncoding?: {charset: string; onUnrepresentable?: 'reject'};
    hostVerifier?: SftpHostVerifier;
    readyTimeout?: number;
    /** Opt in to requiring both application-provided trust hooks. */
    requireTrustPolicy?: boolean;
    /** Look up this exact host, port and public key before asking for acceptance. */
    hasTrustPolicy?: SftpTrustPolicy;
    /** Ask the application's CLI/UI to approve; persistence belongs to the application. */
    acceptTrustPolicy?: SftpTrustPolicy;
}

export interface FtpTransferConfig extends Omit<FtpConnectorConfig,
    'user' | 'password' | 'port' | 'secure' | 'initialPath' | 'passive'> {
    protocol: 'ftp' | 'ftps' | 'ftps-implicit';
    username: string;
    password?: string;
    port?: number;
    root?: string;
    passive?: boolean | null;
}

export interface SftpTransferConfig extends Omit<SftpConnectorConfig, 'port' | 'initialPath'> {
    protocol: 'sftp';
    port?: number;
    root?: string;
}

export type TransferConfig = FtpTransferConfig | SftpTransferConfig;
export type TransferProtocol = TransferConfig['protocol'];

/** Validate shared configuration without loading or connecting either transport. */
export function validateTransferConfig(config: TransferConfig): {port: number; root: string} {
    if (!config || typeof config.host !== 'string' || !config.host.trim() || typeof config.username !== 'string') {
        throw new TypeError('A connection requires a host and username');
    }

    if (!['ftp', 'ftps', 'ftps-implicit', 'sftp'].includes(config.protocol)) {
        throw new UnsupportedProtocolError('Unsupported transfer protocol');
    }

    const port = config.port ?? (config.protocol === 'sftp' ? 22 : config.protocol === 'ftps-implicit' ? 990 : 21);

    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        throw new RangeError('The connection port must be an integer from 1 to 65535');
    }

    const root = config.root ?? '';
    const invalidCharacters = typeof root !== 'string' || Array.from(root).some(character => {
        const code = character.charCodeAt(0);

        return code <= 31 || code === 127 || code === 92;
    });

    if (invalidCharacters || root.split('/').includes('..')) {
        throw new TypeError('The remote root must use forward slashes without parent traversal');
    }

    return {port, root};
}
