import {afterEach, describe, expect, it, vi} from 'vitest';
import {Dockline, createConnector, relativeRemotePath, type SftpTransferConfig} from '../src/Dockline.js';
import {FtpConnector} from '@jalsoedesign/dockline-ftp-client';
import {SftpConnector} from '@jalsoedesign/dockline-sftp-client';
import {OperationAbortedError, UnsupportedProtocolError} from '@jalsoedesign/dockline-abstract';

const connection: SftpTransferConfig = {
    protocol: 'sftp',
    host: 'fixture.invalid',
    username: 'fixture',
    password: 'private-password',
    root: '/deploy',
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SDK configuration contract', () => {
    it.each([
        ['ftp', 21, false],
        ['ftps', 21, true],
        ['ftps-implicit', 990, 'implicit'],
    ] as const)('maps %s to its actual transport security and port', (protocol, port, secure) => {
        const connector = createConnector({
            protocol,
            host: 'fixture.invalid',
            username: 'fixture',
            root: '/deploy',
        });

        expect(connector).toBeInstanceOf(FtpConnector);
        expect((connector as any).config).toMatchObject({
            port,
            secure,
            user: 'fixture',
            password: '',
            passive: true,
            initialPath: '/deploy',
        });
    });

    it('keeps SSH options and callbacks on the same selected SFTP transport', () => {
        const hasTrustPolicy = vi.fn(() => true);
        const acceptTrustPolicy = vi.fn(() => false);
        const credentialProvider = vi.fn(async () => ({type: 'password' as const, password: 'vault-password'}));
        const connector = createConnector({
            ...connection,
            credentialProvider,
            requireTrustPolicy: true,
            hasTrustPolicy,
            acceptTrustPolicy,
            maxTransientRetries: 0,
        });

        expect(connector).toBeInstanceOf(SftpConnector);
        expect((connector as any).config).toMatchObject({
            port: 22,
            username: 'fixture',
            initialPath: '/deploy',
            credentialProvider,
            hasTrustPolicy,
            acceptTrustPolicy,
            requireTrustPolicy: true,
            maxTransientRetries: 0,
        });
        expect(credentialProvider).not.toHaveBeenCalled();
    });

    it('preserves explicit FTP compatibility and TLS settings', () => {
        const secureOptions = {servername: 'ftp.example.test', rejectUnauthorized: true};
        const connector = createConnector({
            protocol: 'ftps',
            host: 'fixture.invalid',
            username: 'fixture',
            port: 2121,
            passive: null,
            secureOptions,
        });

        expect((connector as any).config).toMatchObject({
            port: 2121,
            passive: null,
            secureOptions,
            initialPath: '',
        });
    });

    it.each([
        0,
        -1,
        65536,
        1.5,
        Number.NaN,
    ])('rejects invalid port %s before constructing a usable connection', port => {
        expect(() => createConnector({...connection, port})).toThrow(RangeError);
    });

    it('rejects missing identity and unsupported protocols before network work', () => {
        expect(() => createConnector(null as never)).toThrow(TypeError);
        expect(() => createConnector({...connection, host: '   '})).toThrow(TypeError);
        expect(() => createConnector({...connection, username: undefined} as never)).toThrow(TypeError);
        expect(() => createConnector({...connection, protocol: 'https'} as never)).toThrow(UnsupportedProtocolError);
    });

    it.each(['/deploy/../private', 'C:\\deploy', '/bad\nroot'])('rejects unsafe root %j', root => {
        expect(() => createConnector({...connection, root})).toThrow(TypeError);
    });

    it('serializes only an intentional connection description without credentials or hooks', () => {
        const remote = Dockline.create({
            ...connection,
            privateKey: 'private-key-contents',
            privateKeyPath: '/private/key.pem',
            passphrase: 'private-passphrase',
            agent: '/private/agent.sock',
            credentialProvider: async () => ({type: 'password', password: 'vault-password'}),
        });
        const serialized = JSON.stringify({remote});

        expect(JSON.parse(serialized)).toEqual({
            remote: {
                protocol: 'sftp',
                host: 'fixture.invalid',
                port: 22,
                root: '/deploy',
            },
        });
        expect(serialized).not.toContain('private');
        expect(serialized).not.toContain('username');
        expect(serialized).not.toContain('credentialProvider');
    });
});

describe('SDK remote paths', () => {
    it.each([
        '/absolute/file',
        '../outside',
        'safe/../outside',
        'safe\\outside',
        'C:/outside',
        'safe\u0000name',
        'safe\nname',
        'safe\u007fname',
        '\uD800.txt',
        '',
        '.',
    ])('rejects invalid file path %j', remotePath => {
        expect(() => relativeRemotePath(remotePath)).toThrow(TypeError);
    });

    it('normalizes harmless relative segments and preserves valid Unicode names', () => {
        expect(relativeRemotePath('./releases//./blå-日本.zip')).toBe('releases/blå-日本.zip');
        expect(relativeRemotePath('version..txt')).toBe('version..txt');
        expect(relativeRemotePath('', true)).toBe('.');
        expect(relativeRemotePath('./', true)).toBe('.');
    });

    it('rejects paths at the facade before invoking any transport method', async () => {
        const remote = new Dockline(connection);
        const read = vi.spyOn(remote.connector, 'read');
        const write = vi.spyOn(remote.connector, 'write');
        const list = vi.spyOn(remote.connector, 'list');
        const rename = vi.spyOn(remote.connector, 'renameFile');

        await expect(remote.read('../outside')).rejects.toThrow(TypeError);
        await expect(remote.write('/outside', 'contents')).rejects.toThrow(TypeError);
        expect(() => remote.list('C:/outside')).toThrow(TypeError);
        expect(() => remote.rename('inside', '../outside', {overwrite: 'fail'})).toThrow(TypeError);
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(rename).not.toHaveBeenCalled();
    });
});

describe('SDK connection ownership', () => {
    it('connects, completes the callback and closes once before returning its result', async () => {
        const events: string[] = [];
        const connect = vi.spyOn(SftpConnector.prototype, 'connect').mockImplementation(async () => {
            events.push('connect');
        });
        const disconnect = vi.spyOn(SftpConnector.prototype, 'disconnect').mockImplementation(async () => {
            events.push('disconnect');
        });
        const result = await Dockline.withConnection(connection, async remote => {
            expect(remote).toBeInstanceOf(Dockline);
            events.push('callback');

            return {count: 3};
        });

        expect(result).toEqual({count: 3});
        expect(events).toEqual(['connect', 'callback', 'disconnect']);
        expect(connect).toHaveBeenCalledOnce();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('closes a failed initial connection without running the callback', async () => {
        const failure = new Error('Connection failed');
        const callback = vi.fn();
        const disconnect = vi.spyOn(SftpConnector.prototype, 'disconnect').mockResolvedValue();

        vi.spyOn(SftpConnector.prototype, 'connect').mockRejectedValue(failure);
        await expect(Dockline.withConnection(connection, callback)).rejects.toBe(failure);
        expect(callback).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('preserves the callback failure after closing its connection', async () => {
        const failure = new OperationAbortedError();
        const disconnect = vi.spyOn(SftpConnector.prototype, 'disconnect').mockResolvedValue();

        vi.spyOn(SftpConnector.prototype, 'connect').mockResolvedValue();
        await expect(Dockline.withConnection(connection, async () => {
            throw failure;
        })).rejects.toBe(failure);
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('retains both callback and cleanup failures in order', async () => {
        const operation = new Error('Operation failed');
        const cleanup = new Error('Cleanup failed');

        vi.spyOn(SftpConnector.prototype, 'connect').mockResolvedValue();
        vi.spyOn(SftpConnector.prototype, 'disconnect').mockRejectedValue(cleanup);

        const failure = await Dockline.withConnection(connection, async () => {
            throw operation;
        }).catch(error => error);

        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.errors).toEqual([operation, cleanup]);
    });

    it('does not hide cleanup failure after a successful callback', async () => {
        const cleanup = new Error('Cleanup failed');

        vi.spyOn(SftpConnector.prototype, 'connect').mockResolvedValue();
        vi.spyOn(SftpConnector.prototype, 'disconnect').mockRejectedValue(cleanup);
        await expect(Dockline.withConnection(connection, async () => 'success')).rejects.toBe(cleanup);
    });

    it('hands ownership of an explicitly connected session to its caller', async () => {
        const disconnect = vi.spyOn(SftpConnector.prototype, 'disconnect').mockResolvedValue();

        vi.spyOn(SftpConnector.prototype, 'connect').mockResolvedValue();

        const remote = await Dockline.connect(connection);

        expect(remote).toBeInstanceOf(Dockline);
        expect(disconnect).not.toHaveBeenCalled();
        await remote.disconnect();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('preserves both failed explicit connection and failed cleanup', async () => {
        const connectionFailure = new Error('Connection failed');
        const cleanup = new Error('Cleanup failed');

        vi.spyOn(SftpConnector.prototype, 'connect').mockRejectedValue(connectionFailure);
        vi.spyOn(SftpConnector.prototype, 'disconnect').mockRejectedValue(cleanup);

        const failure = await Dockline.connect(connection).catch(error => error);

        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.errors).toEqual([connectionFailure, cleanup]);
    });
});
