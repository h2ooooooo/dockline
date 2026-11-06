import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Dockline} from '@jalsoedesign/dockline-core';
import {localServer, temporaryDemo} from './demo-support.mjs';

const protocol = process.argv[2] ?? 'ftp';

if (!['ftp', 'sftp'].includes(protocol)) {
    throw new Error('Choose ftp or sftp.');
}

await temporaryDemo(async directory => {
    const server = await localServer(protocol, directory);
    const config = {
        protocol,
        host: '127.0.0.1',
        port: server.port,
        username: 'fixture',
        password: 'fixture-password',
        root: '/',
        ...(protocol === 'sftp' ? {
            requireTrustPolicy: true,
            hasTrustPolicy: challenge => challenge.fingerprint === server.fingerprint,
            acceptTrustPolicy: () => false,
        } : {}),
    };

    try {
        await writeFile(path.join(directory, 'input.txt'), 'Hello from Dockline!\n');
        await Dockline.withConnection(config, async remote => {
            await remote.uploadFile(path.join(directory, 'input.txt'), 'hello.txt');
            console.log('Uploaded hello.txt');

            const details = await remote.stat('hello.txt');

            assert.equal(details.size, 21);
            console.log('Remote size:', details.size);
            await remote.downloadFile('hello.txt', path.join(directory, 'output.txt'));
            assert.equal(await readFile(path.join(directory, 'output.txt'), 'utf8'), 'Hello from Dockline!\n');
            console.log('Downloaded identical content');
            await remote.rename('hello.txt', 'renamed.txt', {
                overwrite: protocol === 'sftp' ? 'fail' : 'replace',
            });
            console.log('Renamed hello.txt to renamed.txt');
            await remote.deleteFile('renamed.txt');
            console.log('Removed renamed.txt');
            await remote.createDirectory('notes');
            await remote.write('notes/readme.txt', 'Hello from a stream\n');

            const stream = await remote.read('notes/readme.txt');

            stream.setEncoding('utf8');

            for await (const chunk of stream) {
                process.stdout.write(chunk);
            }

            const entries = [];

            for await (const entry of remote.list('notes')) {
                entries.push(entry.path.split('/').at(-1));
            }

            assert.deepEqual(entries, ['readme.txt']);
            console.log('Listed:', entries.join(', '));
        });
        console.log('Connection closed');
    } finally {
        await server.close();
        console.log('Local server stopped');
    }
});
