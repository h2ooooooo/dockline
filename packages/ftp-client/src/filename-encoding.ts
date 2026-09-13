import {NotSupportedError} from './errors.js';
import type {FtpFilenameEncoding, FtpFilenameEncodingOptions} from '@dockline/abstract';

export type {FtpFilenameEncoding, FtpFilenameEncodingOptions} from '@dockline/abstract';

export function resolveFilenameEncoding(options?: FtpFilenameEncodingOptions): FtpFilenameEncoding {
    if (options?.onUnrepresentable !== undefined && options.onUnrepresentable !== 'reject') {
        throw new NotSupportedError('FTP filename conversion must reject unrepresentable names');
    }

    const charset = options?.charset?.toLowerCase().replace(/-/g, '') ?? 'utf8';

    if (charset === 'utf8' || charset === 'ascii' || charset === 'latin1') {
        return charset;
    }

    if (charset === 'iso88591') {
        return 'latin1';
    }

    throw new NotSupportedError('FTP filename encoding supports only UTF-8, ASCII and ISO-8859-1 (latin1)');
}

export function validateFilename(value: string, encoding: FtpFilenameEncoding): void {
    if (typeof value !== 'string' || /[\r\n\0]/u.test(value)) {
        throw new NotSupportedError('FTP paths and control values cannot contain CR, LF or NUL');
    }

    const roundTrip = Buffer.from(value, encoding).toString(encoding);

    if (roundTrip !== value || (encoding === 'utf8' && value.includes('\uFFFD'))) {
        throw new NotSupportedError('FTP name cannot be represented losslessly in the configured filename encoding');
    }
}
