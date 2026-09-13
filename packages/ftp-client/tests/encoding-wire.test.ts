import {afterEach, describe, expect, it} from 'vitest';
import {createServer, type Server, type Socket} from 'node:net';
import {Readable} from 'node:stream';
import {FtpConnector} from '../src/FtpConnector.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const release of cleanup.splice(0).reverse()) {
        await release();
    }
});

async function listen(server: Server): Promise<number> {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    return (server.address() as {port: number}).port;
}

async function fixture(encoding: 'utf8' | 'latin1') {
    const sockets = new Set<Socket>();
    const dataServers: Server[] = [];
    const files = new Map<string, Buffer>();
    const observedPaths: string[] = [];
    const commands: string[] = [];
    const server = createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.setEncoding(encoding);

        const reply = (value: string) => socket.write(`${value}\r\n`, encoding);
        let input = '';
        let dataConnection: Promise<Socket> | undefined;
        let renameSource: string | undefined;

        reply('220 Encoding fixture');

        const transfer = async (command: string, path: string) => {
            if (!dataConnection) {
                throw new Error('No data connection');
            }

            reply('150 Opening data connection');

            const data = await dataConnection;

            dataConnection = undefined;

            if (command === 'STOR') {
                const chunks: Buffer[] = [];

                for await (const chunk of data) {
                    chunks.push(Buffer.from(chunk));
                }

                files.set(path, Buffer.concat(chunks));
                observedPaths.push(path);
            } else if (command === 'RETR') {
                observedPaths.push(path);
                data.end(files.get(path)!);
            } else {
                const listing = [...files].map(([name, bytes]) =>
                    `type=file;size=${bytes.length};modify=20260912000000; ${name}\r\n`).join('');

                data.end(Buffer.from(listing, encoding));
            }

            reply('226 Transfer complete');
        };

        const handle = async (line: string) => {
            const boundary = line.indexOf(' ');
            const command = boundary < 0 ? line : line.slice(0, boundary);
            const argument = boundary < 0 ? '' : line.slice(boundary + 1);

            commands.push(command);

            if (command === 'USER') {
                reply('331 Password required');
            } else if (command === 'PASS') {
                reply('230 Logged in');
            } else if (command === 'FEAT') {
                reply('211-Features\r\n MLST type;size;modify;\r\n211 End');
            } else if (command === 'EPSV') {
                const dataServer = createServer();

                dataServers.push(dataServer);
                dataConnection = new Promise<Socket>(resolve => dataServer.once('connection', data => {
                    sockets.add(data);
                    data.on('close', () => sockets.delete(data));
                    resolve(data);
                }));

                const port = await listen(dataServer);

                reply(`229 Entering Extended Passive Mode (|||${port}|)`);
            } else if (command === 'STOR' || command === 'RETR' || command === 'MLSD') {
                await transfer(command, argument);
            } else if (command === 'RNFR') {
                renameSource = argument;
                observedPaths.push(argument);
                reply('350 Ready for destination');
            } else if (command === 'RNTO' && renameSource !== undefined) {
                const bytes = files.get(renameSource);

                if (!bytes) {
                    throw new Error('Missing rename source');
                }

                files.delete(renameSource);
                files.set(argument, bytes);
                observedPaths.push(argument);
                reply('250 Renamed');
            } else if (command === 'DELE') {
                files.delete(argument);
                observedPaths.push(argument);
                reply('250 Deleted');
            } else if (command === 'QUIT') {
                reply('221 Goodbye');
                socket.end();
            } else {
                reply('200 Accepted');
            }
        };

        socket.on('data', (chunk: string) => {
            input += chunk;

            for (let boundary = input.indexOf('\r\n'); boundary >= 0; boundary = input.indexOf('\r\n')) {
                const line = input.slice(0, boundary);

                input = input.slice(boundary + 2);
                void handle(line).catch(() => reply('550 Fixture rejected command'));
            }
        });
    });
    const port = await listen(server);

    cleanup.push(async () => {
        for (const socket of sockets) {
            socket.destroy();
        }

        for (const listener of [...dataServers, server]) {
            await new Promise<void>(resolve => listener.close(() => resolve()));
        }
    });

    const connector = new FtpConnector({
        host: '127.0.0.1',
        port,
        user: 'fixture',
        password: 'public-fixture',
        secure: false,
        initialPath: '',
        passive: true,
        filenameEncoding: {charset: encoding},
        timeoutMs: 2000,
        maxTransientRetries: 0,
    });

    cleanup.push(() => connector.disconnect());

    return {
        connector,
        observedPaths,
        commands,
        files,
    };
}

describe('FTP filename encoding over a real loopback connection', () => {
    it.each(['utf8', 'latin1'] as const)('round-trips %s filenames and binary content through list/read/write/rename/delete', async encoding => {
        const {connector, observedPaths, files} = await fixture(encoding);
        const filename = encoding === 'utf8' ? 'café-雪.bin' : 'café-déjà.bin';
        const destination = encoding === 'utf8' ? 'renamed-雪.bin' : 'renommé.bin';
        const payload = Buffer.from([
            0,
            1,
            128,
            193,
            255,
            10,
        ]);

        await connector.write(filename, Readable.from([payload]), {});

        const entries = [];

        for await (const entry of connector.list('', {deep: false})) {
            entries.push(entry.path);
        }

        expect(entries).toEqual([filename]);

        const received: Buffer[] = [];

        for await (const chunk of await connector.read(filename, {}) as Readable) {
            received.push(Buffer.from(chunk));
        }

        expect(Buffer.concat(received)).toEqual(payload);
        await connector.moveFile(filename, destination, {});
        await connector.deleteFile(destination, {});
        expect(observedPaths).toEqual([
            filename,
            filename,
            filename,
            destination,
            destination,
        ]);
        expect(files.size).toBe(0);
    });
});
