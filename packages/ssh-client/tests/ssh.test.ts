import {describe, it, expect} from 'vitest';
import ssh2, {type Connection} from 'ssh2';
import {generateKeyPairSync, createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SshClient, quotePosix} from '../src/index.js';
import {createLocalSftp} from '../../sftp-client/tests/local-sftp.js';

async function endpoint(userKey?: ReturnType<typeof ssh2.utils.parseKey>) {
    const keys = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs1', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
    const parsed = ssh2.utils.parseKey(keys.privateKey);

    if (parsed instanceof Error || Array.isArray(parsed)) {
        throw new Error('Fixture key unavailable.');
    }

    const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
    const clients = new Set<Connection>();
    const commands: string[] = [];
    const server = new ssh2.Server({hostKeys: [keys.privateKey]}, client => {
        clients.add(client);
        client.on('error', () => {});
        client.on('close', () => clients.delete(client));
        client.on('authentication', context => {
            if (context.method === 'password' && context.username === 'fixture' && context.password === 'test') {
                context.accept();
            } else if (
                context.method === 'publickey' &&
                context.username === 'fixture' &&
                userKey &&
                !(userKey instanceof Error) &&
                context.key.data.equals(userKey.getPublicSSH()) &&
                (!context.signature ||
                    userKey.verify(context.blob!, context.signature, context.hashAlgo))
            ) {
                context.accept();
            } else {
                context.reject();
            }
        });
        client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
            const channel = acceptExec();

            commands.push(info.command);

            const sudoPrompt = /-p '([^']+)'/.exec(info.command)?.[1];

            if (sudoPrompt) {
                channel.stderr.write(sudoPrompt.slice(0, 10));
                setTimeout(() => channel.stderr.write(sudoPrompt.slice(10)), 5);
                channel.once('data', (data: Buffer) => {
                    channel.exit(data.toString() === 'sudo-secret\n' ? 0 : 1);
                    channel.end();
                });

                return;
            }

            if (info.command.includes('hang')) {
                return;
            }

            if (info.command.includes('fail')) {
                channel.stderr.write('failed');
                channel.exit(7);
                channel.end();

                return;
            }

            channel.write(info.command);
            channel.exit(0);
            channel.end();
        })));
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    return {
        commands,
        config: {
            host: '127.0.0.1',
            port: (server.address() as {port: number}).port,
            username: 'fixture',
            password: 'test',
            hostFingerprint: fingerprint,
        },
        close: async () => {
            for (const client of clients) {
                client.end();
            }

            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

describe('SSH client', () => {
    it('quotes arguments, returns output, exposes exit failures and scopes sudo users', async () => {
        const server = await endpoint();

        try {
            const client = new SshClient(server.config);

            await client.withConnection(async session => {
                const result = await session.exec('echo', ["it's a file; $(no)"]);

                expect(result.code).toBe(0);
                expect(result.stdout).toContain(quotePosix("it's a file; $(no)"));
                await expect(session.exec('fail')).rejects.toThrow('status 7');
                expect((await session.exec('fail', [], {allowFailure: true})).code).toBe(7);
                await session.asUser('postgres', async scoped => {
                    await scoped.exec('id');
                });
                expect(server.commands.at(-1)).toBe("sudo -n -u 'postgres' -- 'id'");
            });
        } finally {
            await server.close();
        }
    });

    it('rejects untrusted host keys and times out stalled commands', async () => {
        const server = await endpoint();

        try {
            await expect(new SshClient({
                ...server.config,
                hostFingerprint: undefined,
            }).withConnection(async () => {})).rejects.toThrow();
            await expect(new SshClient(server.config).withConnection(session => session.exec('hang', [], {timeout: 80}))).rejects.toThrow('remote process');
        } finally {
            await server.close();
        }
    });

    it('pins overridden fingerprints and sends one prompted sudo password through stdin across user scopes', async () => {
        const server = await endpoint();
        const logs: string[] = [];
        let prompts = 0;
        const client = new SshClient({...server.config, sudo: {password: 'prompt'}}, {
            ask: async () => {
                prompts++;

                return 'sudo-secret';
            },
            log: message => logs.push(message),
        });

        try {
            await expect(client.withConnection({hostFingerprint: 'SHA256:wrong'}, async () => {})).rejects.toThrow();
            await client.withConnection(async session => {
                await session.asUser('root', scoped => scoped.exec('id'));
                await session.asUser('postgres', scoped => scoped.exec('id'));
            });
            expect(prompts).toBe(1);
            expect(server.commands.join(' ')).not.toContain('sudo-secret');
            expect(logs.join(' ')).not.toContain('sudo-secret');
            expect(logs.join(' ')).not.toContain('DOCKLINE_SUDO');
        } finally {
            await server.close();
        }
    });

    it('uses Dockline SFTP for downloads and preserves an existing file when its byte limit fails', async () => {
        const server = await createLocalSftp();
        const directory = await mkdtemp(path.join(tmpdir(), 'dockline-ssh-'));
        const client = new SshClient({
            host: '127.0.0.1',
            port: server.port,
            username: 'fixture',
            password: 'fixture-password',
            hostFingerprint: server.fingerprint,
        }, {directory});

        try {
            await writeFile(path.join(directory, 'download.bin'), 'original');
            await client.withConnection(async session => {
                await expect(session.download({sourceFile: '/large.bin', destinationFile: 'download.bin', maxBytes: 10})).rejects.toThrow();
                expect(await readFile(path.join(directory, 'download.bin'), 'utf8')).toBe('original');
                await session.download({sourceFile: '/large.bin', destinationFile: 'download.bin'});
                expect((await readFile(path.join(directory, 'download.bin'))).length).toBe(2 * 1024 * 1024);
            });
        } finally {
            await server.close();
            await rm(directory, {recursive: true, force: true});
        }
    });
});

it('authenticates SSH commands with an encrypted PPK v3 key', async () => {
    const directory = new URL('../../sftp-client/tests/fixtures/ppk/', import.meta.url);
    const reference = ssh2.utils.parseKey(await readFile(new URL('rsa-reference.openssh', directory)));
    const server = await endpoint(reference);

    try {
        const client = new SshClient({
            ...server.config,
            password: undefined,
            privateKeyPath: (await import('node:url')).fileURLToPath(new URL('v3_rsa_argon2id.ppk', directory)),
            passphrase: 'changeit',
        });
        const result = await client.withConnection(session => session.exec('whoami'));

        expect(result.code).toBe(0);
        expect(result.stdout).toBe("'whoami'");
    } finally {
        await server.close();
    }
});
