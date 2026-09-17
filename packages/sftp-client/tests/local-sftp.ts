import ssh2, {type Connection} from 'ssh2';
import {generateKeyPairSync, createHash} from 'node:crypto';
import path from 'node:path';

const {Server, utils} = ssh2;
const {sftp} = utils;

/** Isolated SSH/SFTP fixture: public test credentials, generated keys, in-memory files. */
export async function createLocalSftp(options: {interactive?: 'single' | 'multiple'; userKey?: {private: string; public: string}} = {}) {
    const hostKey = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {type: 'pkcs1', format: 'pem'},
        publicKeyEncoding: {type: 'spki', format: 'pem'},
    });
    const parsedHostKey = utils.parseKey(hostKey.privateKey);

    if (parsedHostKey instanceof Error || Array.isArray(parsedHostKey)) {
        throw new Error('Could not generate fixture host key');
    }

    const fingerprint = `SHA256:${createHash('sha256').update(parsedHostKey.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
    const userKey = options.userKey ?? utils.generateKeyPairSync('rsa', {
        bits: 2048,
        passphrase: 'fixture-passphrase',
        cipher: 'aes256-cbc',
        rounds: 16,
    });
    const parsedUserKey = utils.parseKey(userKey.public);

    if (parsedUserKey instanceof Error || Array.isArray(parsedUserKey)) {
        throw new Error('Could not generate fixture authentication key');
    }

    const files = new Map<string, Buffer>([
        ['/large.bin', Buffer.alloc(2 * 1024 * 1024, 37)],
        ['/epoch.txt', Buffer.from('epoch')],
        ['/hang.bin', Buffer.from('never responds')],
    ]);
    const directories = new Set(['/']);
    const connections = new Set<Connection>();
    const observations = {
        passwords: 0,
        connections: 0,
        openHandles: 0,
        keyboardRounds: 0,
        keepalives: 0,
    };
    const server = new Server({
        hostKeys: [hostKey.privateKey],
        debug: (message) => {
            if (message.includes('Inbound: GLOBAL_REQUEST (keepalive@openssh.com)')) {
                observations.keepalives++;
            }
        },
    }, (client) => {
        // Flush each protocol response without Linux delayed-ACK/Nagle stalls.
        // The public server method is missing from the upstream Connection declaration.
        (client as Connection & {setNoDelay(noDelay: boolean): void}).setNoDelay(true);

        observations.connections++;
        connections.add(client);
        client.on('error', () => {});
        client.on('close', () => {
            connections.delete(client);
        });
        client.on('request', (accept, _reject, name: string) => {
            if (name === 'keepalive@openssh.com') {
                observations.keepalives++;
                accept?.();
            }
        });
        client.on('authentication', (context) => {
            if (context.method === 'password') {
                observations.passwords++;
            }

            if (context.method === 'keyboard-interactive' && options.interactive) {
                observations.keyboardRounds++;

                if (options.interactive === 'single') {
                    context.prompt([{prompt: 'One-time code: ', echo: false}], 'Fixture', 'Enter fixture code', (answers) => {
                        if (answers.length === 1 && answers[0] === 'fixture-code') {
                            context.accept();
                        } else {
                            context.reject();
                        }
                    });
                } else {
                    context.prompt([
                        {prompt: 'Account: ', echo: true},
                        {prompt: 'One-time code: ', echo: false},
                    ], 'Fixture', 'First round', (answers) => {
                        if (answers[0] !== 'fixture' || answers[1] !== 'fixture-code') {
                            context.reject();

                            return;
                        }

                        observations.keyboardRounds++;
                        context.prompt([{prompt: 'Second code: ', echo: false}], 'Fixture', 'Second round', (answers) => {
                            if (answers.length === 1 && answers[0] === 'second-code') {
                                context.accept();
                            } else {
                                context.reject();
                            }
                        });
                    });
                }

                return;
            }

            if (context.username !== 'fixture' || options.interactive) {
                context.reject();
            } else if (context.method === 'password' && context.password === 'fixture-password') {
                context.accept();
            } else if (
                context.method === 'publickey' &&
                context.key.data.equals(parsedUserKey.getPublicSSH()) &&
                (!context.signature ||
                    parsedUserKey.verify(context.blob!, context.signature, context.hashAlgo))
            ) {
                context.accept();
            } else {
                context.reject();
            }
        });
        client.on('ready', () => client.on('session', (accept) => accept().on('sftp', (acceptSftp) => {
            const channel = acceptSftp();
            const handles = new Map<number, {key: string; listed?: boolean}>();
            let next = 1;

            channel.on('close', () => {
                observations.openHandles -= handles.size;
                handles.clear();
            });

            const attributes = (key: string) => ({
                mode: key === '/link' ? 0o120777 : directories.has(key) ? 0o40755 : 0o100644,
                uid: 1000,
                gid: 1000,
                size: files.get(key)?.length ?? 0,
                atime: 1700000000,
                mtime: key === '/epoch.txt' ? 0 : 1700000000,
            });
            const status = (id: number, code: number) => channel.status(id, code);
            const metadata = (id: number, key: string) => {
                if (key === '/denied') {
                    status(id, sftp.STATUS_CODE.PERMISSION_DENIED);
                } else if (key === '/generic-failure') {
                    status(id, sftp.STATUS_CODE.FAILURE);
                } else if (files.has(key) || directories.has(key) || key === '/link') {
                    channel.attrs(id, attributes(key));
                } else {
                    status(id, sftp.STATUS_CODE.NO_SUCH_FILE);
                }
            };
            const handle = (id: number, key: string) => {
                const value = next++;

                handles.set(value, {key});
                observations.openHandles++;

                const bytes = Buffer.alloc(4);

                bytes.writeUInt32BE(value);
                channel.handle(id, bytes);
            };

            channel.on('REALPATH', (id, key) => channel.name(id, [{filename: path.posix.resolve('/', key), longname: '', attrs: attributes(key)}]));
            channel.on('STAT', metadata);
            channel.on('LSTAT', metadata);
            channel.on('OPEN', (id, key, flags) => {
                if (key === '/denied') {
                    status(id, sftp.STATUS_CODE.PERMISSION_DENIED);

                    return;
                }

                if (flags & sftp.OPEN_MODE.CREAT) {
                    files.set(key, files.get(key) ?? Buffer.alloc(0));
                }

                if (!files.has(key)) {
                    status(id, sftp.STATUS_CODE.NO_SUCH_FILE);

                    return;
                }

                if (flags & sftp.OPEN_MODE.TRUNC) {
                    files.set(key, Buffer.alloc(0));
                }

                handle(id, key);
            });
            channel.on('FSTAT', (id, value) => metadata(id, handles.get(value.readUInt32BE())!.key));
            channel.on('READ', (id, value, offset, length) => {
                const record = handles.get(value.readUInt32BE())!;

                if (record.key === '/hang.bin') {
                    return;
                }

                const bytes = files.get(record.key)!;

                if (offset >= bytes.length) {
                    status(id, sftp.STATUS_CODE.EOF);
                } else {
                    channel.data(id, bytes.subarray(offset, offset + length));
                }
            });
            channel.on('WRITE', (id, value, offset, data) => {
                const key = handles.get(value.readUInt32BE())!.key;
                const old = files.get(key)!;
                const bytes = Buffer.alloc(Math.max(old.length, offset + data.length));

                old.copy(bytes);
                data.copy(bytes, offset);
                files.set(key, bytes);
                status(id, sftp.STATUS_CODE.OK);
            });
            channel.on('CLOSE', (id, value) => {
                if (handles.delete(value.readUInt32BE())) {
                    observations.openHandles--;
                }

                status(id, sftp.STATUS_CODE.OK);
            });
            channel.on('OPENDIR', (id, key) => {
                key = path.posix.resolve('/', key);

                if (directories.has(key)) {
                    handle(id, key);
                } else {
                    status(id, sftp.STATUS_CODE.NO_SUCH_FILE);
                }
            });
            channel.on('READDIR', (id, value) => {
                const record = handles.get(value.readUInt32BE())!;

                if (record.listed) {
                    status(id, sftp.STATUS_CODE.EOF);

                    return;
                }

                record.listed = true;

                const entries = [...directories, ...files.keys(), '/link']
                    .filter((key) => key !== '/' && path.posix.dirname(key) === record.key)
                    .map((key) => ({
                        filename: path.posix.basename(key),
                        longname: `${key === '/link' ? 'l' : directories.has(key) ? 'd' : '-'}rw-r--r-- 1 fixture fixture 0 Jan 1 2020 ${path.posix.basename(key)}`,
                        attrs: attributes(key),
                    }));

                if (entries.length) {
                    channel.name(id, entries);
                } else {
                    status(id, sftp.STATUS_CODE.EOF);
                }
            });
            channel.on('MKDIR', (id, key) => {
                if (directories.has(key)) {
                    status(id, sftp.STATUS_CODE.FAILURE);

                    return;
                }

                directories.add(key);
                status(id, sftp.STATUS_CODE.OK);
            });
            channel.on('REMOVE', (id, key) => {
                status(id, files.delete(key) ? sftp.STATUS_CODE.OK : sftp.STATUS_CODE.NO_SUCH_FILE);
            });
            channel.on('RMDIR', (id, key) => {
                if ([...files.keys(), ...directories].some((entry) => entry.startsWith(key + '/'))) {
                    status(id, sftp.STATUS_CODE.FAILURE);

                    return;
                }

                directories.delete(key);
                status(id, sftp.STATUS_CODE.OK);
            });
            channel.on('RENAME', (id, from, to) => {
                const bytes = files.get(from);

                if (files.has(to)) {
                    status(id, sftp.STATUS_CODE.FAILURE);

                    return;
                }

                if (bytes) {
                    files.set(to, bytes);
                    files.delete(from);
                    status(id, sftp.STATUS_CODE.OK);
                } else {
                    status(id, sftp.STATUS_CODE.NO_SUCH_FILE);
                }
            });
        })));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        port: (server.address() as {port: number}).port,
        fingerprint,
        publicKey: parsedHostKey.getPublicSSH(),
        files,
        userKey,
        observations,
        dropConnections: () => {
            for (const client of connections) {
                client.end();
            }
        },
        close: async () => {
            for (const client of connections) {
                client.end();
            }

            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
