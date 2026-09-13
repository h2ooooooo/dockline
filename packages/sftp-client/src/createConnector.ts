import {UnsupportedProtocolError, validateTransferConfig, type SftpTransferConfig} from '@dockline/abstract';
import {SftpConnector} from './SftpConnector.js';

/** Create an SFTP adapter without opening a connection. */
export function createConnector(config: SftpTransferConfig): SftpConnector {
    const {port, root} = validateTransferConfig(config);

    if (config.protocol !== 'sftp') {
        throw new UnsupportedProtocolError('The SFTP client requires sftp');
    }

    return new SftpConnector({...config, port, initialPath: root});
}
