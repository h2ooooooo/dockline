import {describe, it, expect} from 'vitest';
import {FtpConnector} from '../src/FtpConnector.js';
import {
    AuthError,
    NotFoundError,
    PermissionError,
    ConnectorError,
} from '../src/errors.js';
import {FTPError} from 'basic-ftp';

describe('error mapping', () => {
    it('maps 530 to AuthError', () => {
        const ftpErr = new FTPError({code: 530, message: 'Auth failed'} as any);
        const wrapped = (FtpConnector as any)._wrapErrorForTest(ftpErr) as any;

        expect(wrapped).toBeInstanceOf(AuthError);
        expect(wrapped.cause).toBeUndefined();
    });

    it('keeps ambiguous 550 responses as an error instead of confirmed absence', () => {
        const ftpErr = new FTPError({code: 550, message: 'Not found'} as any);
        const wrapped = (FtpConnector as any)._wrapErrorForTest(ftpErr) as any;

        expect(wrapped).toBeInstanceOf(ConnectorError);
        expect(wrapped).not.toBeInstanceOf(NotFoundError);
    });

    it('maps 532 to PermissionError', () => {
        const ftpErr = new FTPError({code: 532, message: 'Need account'} as any);
        const wrapped = (FtpConnector as any)._wrapErrorForTest(ftpErr) as any;

        expect(wrapped).toBeInstanceOf(PermissionError);
    });

    it('maps other to ConnectorError', () => {
        const ftpErr = new FTPError({code: 421, message: 'Timeout'} as any);
        const wrapped = (FtpConnector as any)._wrapErrorForTest(ftpErr) as any;

        expect(wrapped).toBeInstanceOf(ConnectorError);
    });
});

describe('password not in error messages', () => {
    it('redacts password from error message', () => {
        const password = 'SECRET_PASSWORD';
        const ftpErr = new FTPError({code: 500, message: `Error with ${password}`} as any);
        const wrapped = (FtpConnector as any)._wrapErrorForTest(ftpErr, password) as any;

        expect(wrapped.message).not.toContain(password);
        expect(wrapped.message).toContain('[REDACTED]');
    });
});
