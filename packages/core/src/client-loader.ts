import {createRequire} from 'node:module';
import {ConnectorError, validateTransferConfig, type TransferAdapter, type TransferConfig, type TransferProtocol} from '@dockline/abstract';

const require = createRequire(import.meta.url);

type ClientPackageName = '@dockline/ftp-client' | '@dockline/sftp-client';

export class MissingClientPackageError extends ConnectorError {
    public readonly installCommand: string;

    public constructor(public readonly protocol: TransferProtocol, public readonly packageName: ClientPackageName) {
        const installCommand = `npm install ${packageName}`;

        super(`The ${protocol} protocol requires ${packageName}. Install it with: ${installCommand}`, undefined,
            'DOCKLINE_CLIENT_NOT_INSTALLED');
        this.installCommand = installCommand;
    }
}

/** Resolve one installed client without importing or installing the other protocol. */
export function createConnector(config: TransferConfig): TransferAdapter {
    validateTransferConfig(config);

    const packageName = config.protocol === 'sftp' ? '@dockline/sftp-client' : '@dockline/ftp-client';

    try {
        require.resolve(`${packageName}/package.json`);
    } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
            throw new MissingClientPackageError(config.protocol, packageName);
        }

        throw error;
    }

    // Keep loading outside the presence check: a broken installed client is a different failure.
    const client: unknown = require(packageName);

    if (
        !client ||
        typeof client !== 'object' ||
        !('createConnector' in client) ||
        typeof client.createConnector !== 'function'
    ) {
        throw new TypeError(`${packageName} does not export a compatible createConnector function`);
    }

    return client.createConnector(config) as TransferAdapter;
}
