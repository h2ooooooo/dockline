import {afterEach, expect, it} from 'vitest';
import {Readable} from 'node:stream';
import {PermissionError, NotSupportedError} from '@jalsoedesign/dockline-abstract';
import {SftpConnector} from '../src/SftpConnector.js';
import {createLocalSftp} from './local-sftp.js';

let endpoint: Awaited<ReturnType<typeof createLocalSftp>> | undefined;
const clients: SftpConnector[] = [];
const connect = () => {
    const client = new SftpConnector({
        host: '127.0.0.1',
        port: endpoint!.port,
        username: 'fixture',
        password: 'fixture-password',
        initialPath: '',
        hostVerifier: () => true,
        timeoutMs: 5000,
        maxTransientRetries: 0,
    });

    clients.push(client);

    return client;
};

afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.disconnect()));
    await endpoint?.close();
    endpoint = undefined;
});

it.each([false, true])('creates directories across four independent sessions when same leaf is %s', async sameLeaf => {
    endpoint = await createLocalSftp({mkdirBarrier: {path: '/deploy', participants: 4}});

    const workers = Array.from({length: 4}, connect);
    const results = await Promise.allSettled(workers.map(async (client, index) => {
        const directory = sameLeaf ? '/deploy' : '/deploy/assets/worker-' + index;

        await client.createDirectory(directory);
        await client.write(directory + '/file-' + index + '.txt', Readable.from(['worker-' + index]));
    }));

    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(endpoint.observations.mkdirCollisions).toBeGreaterThanOrEqual(3);

    for (let index = 0; index < 4; index++) {
        const directory = sameLeaf ? '/deploy' : '/deploy/assets/worker-' + index;

        expect(endpoint.files.get(directory + '/file-' + index + '.txt')?.toString()).toBe('worker-' + index);
    }
});

it('preserves permission failures, rejects file and link collisions, and keeps exclusive mkdir exclusive', async () => {
    endpoint = await createLocalSftp({deniedDirectories: ['/denied-directory']});

    const client = connect();

    await expect(client.createDirectory('/denied-directory/child')).rejects.toBeInstanceOf(PermissionError);
    await expect(client.createDirectory('/epoch.txt/child')).rejects.toThrow();
    await expect(client.createDirectory('/link/child')).rejects.toBeInstanceOf(NotSupportedError);
    expect(endpoint.directories.has('/denied-directory/child')).toBe(false);
    expect(endpoint.directories.has('/epoch.txt/child')).toBe(false);
    expect(endpoint.directories.has('/link/child')).toBe(false);
    await client.createDirectory('/already/there');
    await client.createDirectory('/already/there');
    await expect(client.createDirectoryExclusive('/already/there')).rejects.toThrow();
});
