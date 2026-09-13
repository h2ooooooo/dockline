import {UnsupportedProtocolError, validateTransferConfig, type FtpTransferConfig} from '@jalsoedesign/dockline-abstract';
import {FtpConnector} from './FtpConnector.js';

/** Create an FTP/FTPS adapter without opening a connection. */
export function createConnector(config: FtpTransferConfig): FtpConnector {
    const {port, root} = validateTransferConfig(config);

    if (!['ftp', 'ftps', 'ftps-implicit'].includes(config.protocol)) {
        throw new UnsupportedProtocolError('The FTP client requires ftp, ftps or ftps-implicit');
    }

    return new FtpConnector({
        ...config,
        port,
        user: config.username,
        password: config.password ?? '',
        secure: config.protocol === 'ftps-implicit' ? 'implicit' : config.protocol === 'ftps',
        passive: config.passive === undefined ? true : config.passive,
        initialPath: root,
    });
}
