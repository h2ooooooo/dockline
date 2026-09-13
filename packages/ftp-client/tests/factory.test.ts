import {describe, expect, it} from 'vitest';
import {UnsupportedProtocolError} from '@jalsoedesign/dockline-abstract';
import {createConnector} from '../src/createConnector.js';

describe('FTP client factory', () => {
    it.each([
        ['ftp', 21, false],
        ['ftps', 21, true],
        ['ftps-implicit', 990, 'implicit'],
    ] as const)('maps %s into the expected transport settings without connecting', (protocol, port, secure) => {
        const client = createConnector({
            protocol,
            host: 'fixture.invalid',
            username: 'alice',
            root: '/deploy',
        });

        expect((client as any).config).toMatchObject({
            port,
            secure,
            user: 'alice',
            password: '',
            initialPath: '/deploy',
            passive: true,
        });
        expect(client.connectionState).toBe('disconnected');
    });

    it('preserves explicit port and transfer defaults', () => {
        const client = createConnector({
            protocol: 'ftps',
            host: 'fixture.invalid',
            username: 'alice',
            port: 2121,
            passive: null,
            maxBytes: Infinity,
        });

        expect((client as any).config).toMatchObject({port: 2121, passive: null, maxBytes: Infinity});
    });

    it('rejects another transport or unsafe root before opening a connection', () => {
        expect(() => createConnector({protocol: 'sftp', host: 'fixture.invalid', username: 'alice'} as any))
            .toThrow(UnsupportedProtocolError);
        expect(() => createConnector({
            protocol: 'ftp',
            host: 'fixture.invalid',
            username: 'alice',
            root: '../outside',
        }))
            .toThrow(TypeError);
    });
});
