import type {StorageAdapter, WriteOptions} from '@flystorage/file-storage';
import type {ConnectorCapabilities} from './capabilities.js';
import type {ConnectorOperationOptions, TransferContents} from './operation-options.js';
import type {
    ChecksumDetailsOptions, ChecksumResult, CopyStrategyOptions, CopyResult,
    PublishFileOptions, PublicationResult, RenameOptions, WalkOptions, walk,
} from './transfer-tools.js';

/** The shared transfer contract implemented by protocol clients and custom adapters. */
export interface TransferAdapter extends Omit<StorageAdapter, 'write'> {
    connect(options?: ConnectorOperationOptions): Promise<void>;
    disconnect(): Promise<void>;
    write(path: string, contents: TransferContents, options: WriteOptions & ConnectorOperationOptions): Promise<void>;
    createDirectoryExclusive(path: string, options?: ConnectorOperationOptions): Promise<void>;
    removeEmptyDirectory(path: string, options?: ConnectorOperationOptions): Promise<void>;
    renameFile(from: string, to: string, options: RenameOptions): Promise<{atomic: boolean}>;
    serverFeatures(options?: ConnectorOperationOptions): Promise<readonly string[]>;
    serverChecksum?(path: string, algorithm: 'sha256' | 'sha512', options?: ConnectorOperationOptions): Promise<string>;
    validatePublicationOptions(options: PublishFileOptions): void;
    publishFile(path: string, contents: TransferContents, options?: PublishFileOptions): Promise<PublicationResult>;
    checksumDetails(path: string, options?: ChecksumDetailsOptions): Promise<ChecksumResult>;
    copyFileWithStrategy(from: string, to: string, options?: CopyStrategyOptions): Promise<CopyResult>;
    walk(path: string, options?: WalkOptions): ReturnType<typeof walk>;
    capabilities(options?: ConnectorOperationOptions & {negotiate?: boolean}): Promise<ConnectorCapabilities>;
}
