export {
    ConnectorError, AuthError, NotFoundError, PermissionError,
    UnsupportedProtocolError, NotSupportedError, HostTrustError,
    OperationAbortedError, OperationTimeoutError, ConnectionClosedError,
    NameResolutionError, ConnectionRefusedError, CredentialProviderError, DirectoryAccessError,
} from '@jalsoedesign/dockline-abstract';

/** @deprecated Authentication failures share AuthError across all connectors. */
export {AuthError as KeyAuthError} from '@jalsoedesign/dockline-abstract';
