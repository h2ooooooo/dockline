export {SftpConnector} from './SftpConnector.js';
export {KnownHostsStore, KnownHostsConflictError} from './KnownHostsStore.js';
export type {KnownHostsStoreOptions, KnownHostEntry, KnownHostInspection, KnownHostApproval} from './KnownHostsStore.js';
export * from './errors.js';
export type {
    SftpConnectorConfig, SftpHostKeyChallenge, SftpTrustPolicy, SftpHostVerifier,
    SftpKeyboardInteractive, SftpKeyboardInteractiveChallenge,
} from './SftpConnector.js';
export type {ConnectorOperationOptions} from '@jalsoedesign/dockline-abstract';

export {createConnector} from './createConnector.js';
export type {SftpTransferConfig, TransferAdapter} from '@jalsoedesign/dockline-abstract';

export {prepareSshPrivateKey, SshPrivateKeyError} from './PrivateKey.js';
export type {PrivateKeyFailure} from './PrivateKey.js';
