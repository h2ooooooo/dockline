export type ConnectionStage = 'resolve' | 'connect' | 'trust' | 'authenticate' | 'directory' | 'credentials' | 'ready';

export class ConnectorError extends Error {
    public constructor(message: string, public readonly cause?: unknown, public readonly code?: string | number,
        public readonly stage?: ConnectionStage) {
        super(message);
        this.name = new.target.name;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class AuthError extends ConnectorError {
    public readonly stage: ConnectionStage = 'authenticate';
}
export class NotFoundError extends ConnectorError {}
export class PermissionError extends ConnectorError {}
export class UnsupportedProtocolError extends ConnectorError {}
export class NotSupportedError extends ConnectorError {}

export class OperationAbortedError extends ConnectorError {
    public constructor(message = 'The operation was cancelled') {
        super(message, undefined, 'ABORT_ERR');
    }
}

export class OperationTimeoutError extends ConnectorError {
    public constructor(message = 'The operation timed out') {
        super(message, undefined, 'ETIMEDOUT');
    }
}

export class ConnectionClosedError extends ConnectorError {
    public constructor(message = 'The connection closed; enable autoReconnect or call connect() explicitly') {
        super(message, undefined, 'ECONNRESET');
    }
}

export class HostTrustError extends ConnectorError {
    public constructor(message = 'The server host key was not accepted') {
        super(message, undefined, 'HOST_TRUST_REJECTED', 'trust');
    }
}

export class NameResolutionError extends ConnectorError {
    public constructor(message = 'The server name could not be resolved', code = 'ENOTFOUND') {
        super(message, undefined, code, 'resolve');
    }
}

export class ConnectionRefusedError extends ConnectorError {
    public constructor(message = 'The server refused the connection') {
        super(message, undefined, 'ECONNREFUSED', 'connect');
    }
}

export class TlsTrustError extends HostTrustError {}

export class CredentialProviderError extends AuthError {
    public readonly stage: ConnectionStage = 'credentials';

    public constructor(message = 'The credential provider could not supply authentication material') {
        super(message, undefined, 'CREDENTIAL_PROVIDER_FAILED', 'credentials');
    }
}

export class DirectoryAccessError extends ConnectorError {
    public constructor(message = 'The initial directory could not be accessed', code?: string | number) {
        super(message, undefined, code, 'directory');
    }
}

export class ResourceLimitError extends ConnectorError {}
export class IntegrityError extends ConnectorError {}
export class PoolClosedError extends ConnectorError {}
export class PublicationError extends ConnectorError {
    public constructor(message: string, public readonly state: Readonly<{
        destination: string;
        temporaryPath?: string;
        phase: 'prepare' | 'upload' | 'verify' | 'rename' | 'cleanup';
        outcome: 'not-published' | 'published' | 'uncertain';
        cleanup: 'done' | 'retained' | 'failed';
    }>) {
        super(message);
    }
}
