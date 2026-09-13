import {describe, it, expect} from 'vitest';
import {SftpConnector} from '../src/SftpConnector.js';
import {
    AuthError,
    NotFoundError,
    PermissionError,
} from '../src/errors.js';

describe('error mapping', () => {
    it('maps "Authentication failed" to AuthError', () => {
        const err = new Error('Authentication failed');
        const wrapped = (SftpConnector as any)._wrapErrorForTest(err) as any;

        expect(wrapped).toBeInstanceOf(AuthError);
    });

    it('maps "No such file" to NotFoundError', () => {
        const err = new Error('No such file');
        const wrapped = (SftpConnector as any)._wrapErrorForTest(err) as any;

        expect(wrapped).toBeInstanceOf(NotFoundError);
    });

    it('maps "Permission denied" to PermissionError', () => {
        const err = new Error('Permission denied');
        const wrapped = (SftpConnector as any)._wrapErrorForTest(err) as any;

        expect(wrapped).toBeInstanceOf(PermissionError);
    });
});

describe('password not in error messages', () => {
    it('redacts password from error message', () => {
        const password = 'SECRET_PASSWORD';
        const err = new Error(`Error with ${password}`);
        const wrapped = (SftpConnector as any)._wrapErrorForTest(err, {password}) as any;

        expect(wrapped.message).not.toContain(password);
        expect(wrapped.message).toContain('[REDACTED]');
    });
});
