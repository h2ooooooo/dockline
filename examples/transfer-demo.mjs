import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {invokeCli, localServer, repository, temporaryDemo} from './demo-support.mjs';

export async function runTransferDemo(protocol) {
    await temporaryDemo(async directory => {
        const server = await localServer(protocol, directory);

        try {
            console.log(protocol.toUpperCase() + ' server started on 127.0.0.1 (temporary port).');

            const connection = {
                protocol,
                host: '127.0.0.1',
                port: server.port,
                username: 'fixture',
                password: 'fixture-password',
                root: '/',
                ...(protocol === 'sftp' ? {trust: {fingerprint: server.fingerprint}} : {}),
            };
            const file = path.join(directory, 'server.yml');
            const executable = path.join(repository, 'packages/cli/dist/bin.js');

            await writeFile(file, JSON.stringify({version: 1, connection}));
            await writeFile(path.join(directory, 'input.txt'), 'Hello from Dockline!\n');

            for (const [command, args] of [
                ['upload', ['--source-file', 'input.txt', '--destination-file', 'hello.txt']],
                ['list', ['--path', '.']],
                ['download', ['--source-file', 'hello.txt', '--destination-file', 'output.txt']],
                ['remove', ['--path', 'hello.txt']],
            ]) {
                console.log('$ dockline ' + command + ' ' + args.join(' ') + ' --config <temporary-config> --json');

                const result = await invokeCli(executable, [
                    command,
                    ...args,
                    '--config',
                    file,
                    '--json',
                ], directory);

                assert.equal(result.ok, true);
                assert.equal(result.command, command);

                if (command === 'list') {
                    assert.ok(result.entries.some(entry => entry.path.endsWith('hello.txt') && entry.size === 21));
                }

                console.log(JSON.stringify(result).split(JSON.stringify(directory).slice(1, -1)).join('<temporary-directory>'));
            }

            assert.equal(await readFile(path.join(directory, 'output.txt'), 'utf8'), 'Hello from Dockline!\n');

            const final = await invokeCli(executable, [
                'list',
                '--path',
                '.',
                '--config',
                file,
                '--json',
            ], directory);

            assert.ok(!final.entries.some(entry => entry.path.endsWith('hello.txt')));

            if (protocol === 'sftp') {
                connection.trust.fingerprint = 'SHA256:' + Buffer.alloc(32).toString('base64').replace(/=+$/, '');
                await writeFile(file, JSON.stringify({version: 1, connection}));

                const attempts = server.observations.passwords;
                const rejected = await invokeCli(executable, ['list', '--config', file, '--json'], directory, 1);

                assert.equal(rejected.ok, false);
                assert.equal(server.observations.passwords, attempts);
                console.log('Wrong host-key pin rejected before password authentication (exit 1).');
            }

            console.log('PASS: upload, list, exact-byte download and removal over ' + protocol.toUpperCase() + '.');
        } finally {
            await server.close();
            console.log('Local server stopped.');
        }
    });
}
