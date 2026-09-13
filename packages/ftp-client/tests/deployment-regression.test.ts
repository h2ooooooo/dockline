import {describe, it, expect} from 'vitest';
import {Readable, Writable} from 'node:stream';
import {FtpConnector} from '../src/FtpConnector.js';
import {FTPError} from 'basic-ftp';
import {NotFoundError, PermissionError} from '../src/errors.js';

describe('deployment transport regressions', () => {
    it('does not report a completed read before the final control response', async () => {
        const connector = new FtpConnector({
            host: 'unused',
            port: 21,
            user: 'test',
            password: 'test',
            secure: false,
            passive: true,
            initialPath: '',
        });
        const internal = connector as any;

        internal.ensureConnected = async () => {};

        internal.client.downloadTo = async (destination: Writable) => {
            destination.end(Buffer.alloc(256 * 1024, 1));
            await new Promise(resolve => setTimeout(resolve, 20));
            throw new Error('Server rejected transfer completion');
        };

        const read = await connector.read('/file', {}) as Readable;

        await expect((async () => {
            for await (const _chunk of read) { /* drain */ }
        })()).rejects.toThrow('rejected transfer completion');
    });
    it('does not turn permission or ambiguous 550 errors into false existence', async () => {
        const connector = new FtpConnector({
            host: 'unused',
            port: 21,
            user: 'test',
            password: 'test',
            secure: false,
            passive: true,
            initialPath: '',
        });
        const internal = connector as any;

        internal.ensureConnected = async () => {};

        internal.stat = async () => {
            throw new PermissionError('Denied');
        };

        await expect(connector.fileExists('/protected', {})).rejects.toBeInstanceOf(PermissionError);
        expect(FtpConnector._wrapErrorForTest(new FTPError({code: 550, message: 'Unavailable'}))).not.toBeInstanceOf(NotFoundError);
    });
});
