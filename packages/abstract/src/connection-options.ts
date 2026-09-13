import {
    ConnectorError, AuthError, HostTrustError, NameResolutionError, ConnectionRefusedError,
    TlsTrustError, CredentialProviderError, DirectoryAccessError, type ConnectionStage,
} from './errors.js';

export type ConnectorProtocol = 'ftp' | 'sftp';

export interface CredentialContext {
    readonly siteId?: string;
    readonly host: string;
    readonly port: number;
    readonly protocol: ConnectorProtocol;
    readonly purpose: 'connect' | 'reconnect';
    readonly attempt: number;
    readonly abortSignal: AbortSignal;
}

export type ConnectorCredentials =
    {type: 'password'; username?: string; password: string} |
    {
        type: 'private-key';
        username?: string;
        privateKey: string | Buffer;
        passphrase?: string;
    } |
    {type: 'agent'; username?: string; socketPath: string};

export type CredentialProvider = (context: CredentialContext) => ConnectorCredentials | Promise<ConnectorCredentials>;

export interface KeepaliveOptions {
    intervalMs: number;
    maxMissed?: number;
}

export interface ConnectionStateEvent {
    readonly state: 'connecting' | 'ready' | 'disconnected' | 'reconnecting' | 'failed';
    readonly protocol: ConnectorProtocol;
    readonly attempt: number;
    readonly error?: ConnectorError;
}

export interface ConnectorConnectionOptions {
    siteId?: string;
    credentialProvider?: CredentialProvider;
    keepalive?: KeepaliveOptions;
    onConnectionState?: (event: ConnectionStateEvent) => void;
}

/** State callbacks observe the connection; callback failures never change network outcomes. */
export function emitConnectionState(
    callback: ConnectorConnectionOptions['onConnectionState'],
    event: ConnectionStateEvent,
): void {
    try {
        const returned = callback?.(Object.freeze({...event}));

        void Promise.resolve(returned).catch(() => {});
    } catch {
        // An application observer must not turn a confirmed operation into a retry.
    }
}

/** Callers sanitize transport messages before invoking this classifier. Raw causes are never retained. */
export function classifyConnectionError(error: unknown, stage: ConnectionStage): ConnectorError {
    if (
        error instanceof AuthError ||
        error instanceof HostTrustError ||
        (error instanceof ConnectorError &&
            (error.stage !== undefined ||
                error.constructor !== ConnectorError))
    ) {
        return error;
    }

    const message = error instanceof Error ? error.message : 'Connection failed';
    const rawCode = error && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
    const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? rawCode : undefined;

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return new NameResolutionError(message, code);
    }

    if (code === 'ECONNREFUSED') {
        return new ConnectionRefusedError(message);
    }

    if (stage === 'credentials') {
        return new CredentialProviderError();
    }

    if (stage === 'directory') {
        return new DirectoryAccessError(message, code);
    }

    if (stage === 'trust' || /CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|TLS_CERT/.test(String(code))) {
        return new TlsTrustError(message);
    }

    return new ConnectorError(message, undefined, code, stage);
}
