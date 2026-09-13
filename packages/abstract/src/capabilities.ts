import type {ConnectorProtocol} from './connection-options.js';

export type SupportState = 'supported' | 'unsupported' | 'unknown';

export interface Capability {
    readonly state: SupportState;
    readonly condition?: string;
    readonly algorithms?: readonly string[];
}

export interface ConnectorCapabilities {
    readonly schemaVersion: 1;
    readonly protocol: ConnectorProtocol;
    readonly adapter: Readonly<Record<string, Capability>>;
    readonly server: Readonly<Record<string, Capability>>;
    /** Whether server inventory was requested, even if the transport cannot expose it. */
    readonly negotiated: boolean;
    readonly inventory: 'not-requested' | 'advertised' | 'unavailable';
    readonly features: readonly string[];
}

/** Pass features only from the current verified session. This helper never opens a connection or caches identity. */
export function describeCapabilities(protocol: ConnectorProtocol, features?: readonly string[]): ConnectorCapabilities {
    const supported = Object.freeze({state: 'supported'} as const);
    const unsupported = Object.freeze({state: 'unsupported'} as const);
    const unknown = Object.freeze({state: 'unknown'} as const);
    const hashLine = features?.find(value => /^HASH(?:\s|$)/i.test(value));
    const algorithms = ['sha256', 'sha512'].filter(name =>
        hashLine?.toUpperCase().includes(name === 'sha256' ? 'SHA-256' : 'SHA-512'));
    const atomic = protocol === 'sftp' && features?.some(value => value.startsWith('posix-rename@openssh.com'));

    return Object.freeze({
        schemaVersion: 1,
        protocol,
        adapter: Object.freeze({
            read: supported,
            write: supported,
            list: supported,
            walk: supported,
            progress: supported,
            bandwidth: supported,
            clientStreamedCopy: supported,
            serverNativeCopy: unsupported,
            streamChecksum: Object.freeze({state: 'supported', algorithms: Object.freeze(['sha256', 'sha512'])}),
            serverChecksum: protocol === 'ftp' ? supported : unsupported,
            atomicReplace: protocol === 'sftp' ? supported : unsupported,
            noReplaceRename: protocol === 'sftp' ? supported : unsupported,
            visibility: unsupported,
            publicUrl: unsupported,
            resume: unsupported,
        }),
        server: Object.freeze({
            checksum: algorithms.length ? Object.freeze({state: 'supported', algorithms: Object.freeze(algorithms)}) :
                unknown,
            atomicReplace: atomic ? supported : unknown,
            // Adapter support and an advertisement never imply permissions at a particular path.
            pathPermissions: unknown,
        }),
        negotiated: features !== undefined,
        inventory: features === undefined ? 'not-requested' : features.length ? 'advertised' : 'unavailable',
        features: Object.freeze([...(features ?? [])]),
    });
}
