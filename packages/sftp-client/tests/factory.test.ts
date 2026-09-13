import {describe, expect, it} from 'vitest';
import {UnsupportedProtocolError} from '@dockline/abstract';
import {createConnector} from '../src/createConnector.js';

describe('SFTP client factory', () => {
    it('maps shared configuration and preserves application trust hooks without connecting', () => {
        const hasTrustPolicy = () => true;
        const acceptTrustPolicy = () => false;
        const client = createConnector({
            protocol: 'sftp',
            host: 'fixture.invalid',
            username: 'alice',
            root: '/deploy',
            requireTrustPolicy: true,
            hasTrustPolicy,
            acceptTrustPolicy,
        });

        expect((client as any).config).toMatchObject({
            port: 22,
            username: 'alice',
            initialPath: '/deploy',
            requireTrustPolicy: true,
            hasTrustPolicy,
            acceptTrustPolicy,
        });
        expect((client as any).connected).toBe(false);
    });

    it('preserves explicit port, authentication and transfer defaults', () => {
        const client = createConnector({
            protocol: 'sftp',
            host: 'fixture.invalid',
            username: 'alice',
            port: 2222,
            agent: 'pageant',
            maxBytes: 0,
        });

        expect((client as any).config).toMatchObject({port: 2222, agent: 'pageant', maxBytes: 0});
    });

    it('rejects another transport or invalid port before opening a connection', () => {
        expect(() => createConnector({protocol: 'ftp', host: 'fixture.invalid', username: 'alice'} as any))
            .toThrow(UnsupportedProtocolError);
        expect(() => createConnector({
            protocol: 'sftp',
            host: 'fixture.invalid',
            username: 'alice',
            port: 0,
        }))
            .toThrow(RangeError);
    });
});
