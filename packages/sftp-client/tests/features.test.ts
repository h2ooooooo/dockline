import {afterEach, describe, expect, it, vi} from 'vitest';
import {createServer, type Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import ssh2 from 'ssh2';
import {
    AuthError, CredentialProviderError, NotSupportedError, OperationAbortedError,
    OperationTimeoutError, type TransferProgressEvent,
} from '@dockline/abstract';
import {SftpConnector, type SftpConnectorConfig} from '../src/SftpConnector.js';
import {createLocalSftp} from './local-sftp.js';

const close: (() => Promise<void>)[] = [];
const endpoint = async (options: Parameters<typeof createLocalSftp>[0] = {}) => {
    const server = await createLocalSftp(options);

    close.push(server.close);

    return server;
};
const connector = (server: Awaited<ReturnType<typeof createLocalSftp>>, options: Partial<SftpConnectorConfig> = {}) => {
    const adapter = new SftpConnector({
        host: '127.0.0.1',
        port: server.port,
        username: 'fixture',
        password: 'fixture-password',
        initialPath: '',
        timeoutMs: 3000,
        maxTransientRetries: 0,
        requireTrustPolicy: true,
        hasTrustPolicy: (challenge) => challenge.fingerprint === server.fingerprint,
        acceptTrustPolicy: () => false,
        ...options,
    });

    close.push(() => adapter.disconnect());

    return adapter;
};
const consume = async (stream: unknown) => {
    const buffers: Buffer[] = [];

    for await (const buffer of stream as Readable) {
        buffers.push(Buffer.from(buffer));
    }

    return Buffer.concat(buffers);
};

afterEach(async () => {
    for (const cleanup of close.splice(0).reverse()) {
        await cleanup();
    }
});

describe('SFTP reviewed connection features', () => {
    it('authenticates through a controlled agent without password or private-key export', async () => {
        const server = await endpoint();
        const key = ssh2.utils.parseKey(server.userKey.private, 'fixture-passphrase');

        if (key instanceof Error || Array.isArray(key)) {
            throw new Error('Invalid fixture key');
        }

        const socketPath = process.platform === 'win32' ?
            `\\\\.\\pipe\\dockline-agent-${randomUUID()}` : join(tmpdir(), `dockline-agent-${randomUUID()}.sock`);
        const sockets = new Set<Socket>();
        let signatures = 0;
        const agent = createServer((socket) => {
            const protocol = new ssh2.AgentProtocol(false);

            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            protocol.on('error', () => socket.destroy());
            protocol.on('identities', (request) => protocol.getIdentitiesReply(request, [key]));
            protocol.on('sign', (request, _publicKey, data, options) => {
                const signature = key.sign(data, options.hash);

                if (signature instanceof Error) {
                    protocol.failureReply(request);

                    return;
                }

                signatures++;
                protocol.signReply(request, signature);
            });
            socket.pipe(protocol).pipe(socket);
        });

        await new Promise<void>((resolve) => agent.listen(socketPath, resolve));
        close.push(async () => {
            for (const socket of sockets) {
                socket.destroy();
            }

            await new Promise<void>((resolve) => agent.close(() => resolve()));
        });

        await connector(server, {agent: socketPath, password: 'should-not-be-sent'}).connect();
        expect(signatures).toBeGreaterThan(0);
        expect(server.observations.passwords).toBe(0);

        await expect(connector(server, {agent: `${socketPath}-missing`}).connect()).rejects.toBeInstanceOf(AuthError);
        expect(server.observations.passwords).toBe(0);
        expect(() => connector(server, {agentForward: true} as never)).toThrow(NotSupportedError);
    });

    it('supports a regular string for a single interactive prompt', async () => {
        const server = await endpoint({interactive: 'single'});

        await connector(server, {keyboardInteractive: 'fixture-code'}).connect();
        expect(server.observations.keyboardRounds).toBe(1);
        expect(server.observations.passwords).toBe(0);
    });

    it('preserves prompt order and echo flags across interactive challenge rounds', async () => {
        const server = await endpoint({interactive: 'multiple'});
        const rounds: string[] = [];

        await connector(server, {
            keyboardInteractive: async (challenge) => {
                rounds.push(challenge.instructions);
                expect(challenge.abortSignal.aborted).toBe(false);

                if (challenge.instructions === 'First round') {
                    expect(challenge.prompts.map((prompt) => prompt.echo)).toEqual([true, false]);

                    return ['fixture', 'fixture-code'];
                }

                return ['second-code'];
            },
        }).connect();

        expect(rounds).toEqual(['First round', 'Second round']);
    });

    it('rejects malformed answers without leaking them or silently retrying prompts', async () => {
        const server = await endpoint({interactive: 'multiple'});
        const provider = vi.fn(() => ['secret-answer']);

        await expect(connector(server, {keyboardInteractive: provider, maxTransientRetries: 3}).connect())
            .rejects.toMatchObject({name: 'AuthError', stage: 'authenticate'});
        expect(provider).toHaveBeenCalledTimes(1);
        expect(server.observations.connections).toBe(1);
        await expect(connector(server, {keyboardInteractive: 'secret-answer'}).connect()).rejects.toBeInstanceOf(AuthError);
    });

    it('aborts pending interactive input and never sends a late answer', async () => {
        const server = await endpoint({interactive: 'single'});
        const controller = new AbortController();
        let release!: (answers: string[]) => void;
        let inputSignal: AbortSignal | undefined;
        const adapter = connector(server, {
            keyboardInteractive: (challenge) => {
                inputSignal = challenge.abortSignal;

                return new Promise<string[]>((resolve) => {
                    release = resolve;
                });
            },
        });
        const operation = adapter.connect({abortSignal: controller.signal});
        const rejected = expect(operation).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(inputSignal).toBeDefined());
        controller.abort();
        await rejected;
        expect(inputSignal!.aborted).toBe(true);
        release(['fixture-code']);
        expect(server.observations.passwords).toBe(0);
    });

    it('refreshes credentials on explicit reconnect with bounded identity context', async () => {
        const server = await endpoint();
        const calls: unknown[] = [];
        const adapter = connector(server, {
            siteId: 'chosen-site',
            credentialProvider: async (context) => {
                calls.push({...context});

                return {type: 'password', password: 'fixture-password'};
            },
        });

        await adapter.connect();
        await adapter.disconnect();
        await adapter.connect();
        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({
            siteId: 'chosen-site',
            protocol: 'sftp',
            purpose: 'connect',
            attempt: 1,
        });
        expect(calls[1]).toMatchObject({purpose: 'reconnect', attempt: 1});

        const failed = connector(server, {
            credentialProvider: () => {
                throw new Error('private-vault-secret');
            },
        });

        await expect(failed.connect()).rejects.toBeInstanceOf(CredentialProviderError);
        await expect(failed.connect()).rejects.not.toThrow('private-vault-secret');
    });

    it('times out a pending credential request without starting authentication', async () => {
        const server = await endpoint();
        let signal: AbortSignal | undefined;
        const adapter = connector(server, {
            timeoutMs: 30,
            credentialProvider: (context) => {
                signal = context.abortSignal;

                return new Promise(() => {});
            },
        });

        await expect(adapter.connect()).rejects.toBeInstanceOf(OperationTimeoutError);
        expect(signal!.aborted).toBe(true);
        expect(server.observations.connections).toBe(0);
    });

    it('reports lifecycle state and sends SSH keepalives without changing retry ownership', async () => {
        const server = await endpoint();
        const states: string[] = [];
        const adapter = connector(server, {
            keepalive: {intervalMs: 30, maxMissed: 2},
            onConnectionState: ({state}) => {
                states.push(state);

                if (state === 'ready') {
                    throw new Error('observer failure');
                }
            },
        });

        await adapter.connect();
        await vi.waitFor(() => expect(server.observations.keepalives).toBeGreaterThan(0));
        await adapter.disconnect();
        expect(states).toEqual(['connecting', 'ready', 'disconnected']);
    });

    it('validates the UTF-8 configuration before network access', () => {
        const config: SftpConnectorConfig = {
            host: 'fixture.invalid',
            port: 22,
            username: 'fixture',
            initialPath: '',
            keyboardInteractive: 'fixture-code',
            filenameEncoding: {charset: 'UTF-8'},
        };

        expect(new SftpConnector(config)).toBeInstanceOf(SftpConnector);
        expect(() => new SftpConnector({
            ...config,
            filenameEncoding: {charset: 'windows-1252'},
        })).toThrow(NotSupportedError);
    });

    it('reports completed transfers only when streams finish and supports UTF-8 paths unchanged', async () => {
        const server = await endpoint();
        const adapter = connector(server);
        const upload: TransferProgressEvent[] = [];
        const download: TransferProgressEvent[] = [];
        const payload = Buffer.alloc(4096, 229);

        await adapter.write('/blå-日本.bin', Readable.from(payload), {
            onProgress: (event) => upload.push(event),
            bandwidth: 32768,
        });

        const stream = await adapter.read('/blå-日本.bin', {
            onProgress: (event) => download.push(event),
            bandwidth: 32768,
        });

        expect(download.some((event) => event.stage === 'completed')).toBe(false);
        expect(await consume(stream)).toEqual(payload);
        await vi.waitFor(() => expect(download.at(-1)?.stage).toBe('completed'));
        expect(upload.at(-1)).toMatchObject({stage: 'completed', bytesTransferred: payload.length, attempt: 1});
        expect(download.at(-1)).toMatchObject({stage: 'completed', bytesTransferred: payload.length, attempt: 1});
        expect(server.files.get('/blå-日本.bin')).toEqual(payload);
    });
});
