import ssh2, {type ClientChannel} from 'ssh2';

const {Client} = ssh2;

import {createHash, randomUUID} from 'node:crypto';
import {readFile, mkdir, rename, unlink} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {SftpConnector, prepareSshPrivateKey} from '@jalsoedesign/dockline-sftp-client';
import {homedir} from 'node:os';
import {milliseconds, type SshOptions, type Question} from './types.js';

const absolutePath = (base: string, value: string) => path.resolve(base, value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);

export interface ResolvedSsh extends SshOptions {
    host: string;
    port: number;
    username: string;
    password?: string;
    passphrase?: string;
}
export interface ExecOptions {
    timeout?: string | number;
    sudo?: boolean | string;
    allowFailure?: boolean;
}
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface FileTransfer {
    sourceFile: string;
    destinationFile: string;
    timeout?: string | number;
    maxBytes?: number;
}
export interface SshServices {
    resolve(options: SshOptions): Promise<ResolvedSsh>;
    ask(question: Question): Promise<string | boolean>;
    trust(host: string, port: number, fingerprint: string): Promise<boolean>;
    log(message: string): void;
    signal: AbortSignal;
    directory: string;
}

export function quotePosix(value: string): string {
    if (value.includes('\0')) {
        throw new Error('SSH arguments cannot contain NUL.');
    }

    return `'${value.replaceAll("'", "'\\''")}'`;
}

export class SshSession {
    public constructor(private readonly client: ssh2.Client, private readonly config: ResolvedSsh,
        private readonly services: SshServices, private readonly user?: string,
        private readonly credentials: {sudoPassword?: string} = {}) {}

    public async asUser<T>(user: string, callback: (session: SshSession) => Promise<T>): Promise<T> {
        if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(user)) {
            throw new Error('Invalid sudo user.');
        }

        return callback(new SshSession(this.client, this.config, this.services, user, this.credentials));
    }

    public exec(program: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
        return this.execute([program, ...args].map(quotePosix).join(' '), options);
    }

    public shell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
        return this.exec('sh', ['-c', command], options);
    }

    private async execute(command: string, options: ExecOptions): Promise<ExecResult> {
        const sudoUser = typeof options.sudo === 'string' ? options.sudo : this.user;
        const sudo = Boolean(options.sudo || sudoUser);
        const marker = `DOCKLINE_SUDO_${randomUUID()}`;
        let password: string | undefined;

        if (sudo && (this.config.sudo?.password === 'prompt' || this.config.sudo?.passwordEnv)) {
            password = this.config.sudo.passwordEnv ?
                process.env[this.config.sudo.passwordEnv] : this.credentials.sudoPassword;

            if (password === undefined && this.config.sudo.passwordEnv) {
                throw new Error(`Missing sudo secret environment variable: ${this.config.sudo.passwordEnv}`);
            }

            password ??= String(await this.services.ask({
                id: `sudo:${this.config.username}@${this.config.host}`,
                type: 'password',
                message: 'Sudo password',
                required: true,
            }));
            this.credentials.sudoPassword = password;
        }

        if (sudo) {
            command = `sudo ${password === undefined ? '-n' : `-S -p ${quotePosix(marker)}`} ${sudoUser ? `-u ${quotePosix(sudoUser)} ` : ''}-- ${command}`;
        }

        const timeout = AbortSignal.timeout(milliseconds(options.timeout ?? '1h'));
        const signal = AbortSignal.any([this.services.signal, timeout]);

        signal.throwIfAborted();

        return new Promise<ExecResult>((resolve, reject) => {
            let channel: ClientChannel | undefined;
            let stdout = '';
            let stderr = '';
            let pending = '';
            let sent = false;
            const finish = (error?: Error, code = -1) => {
                signal.removeEventListener('abort', abort);
                this.client.removeListener('close', disconnected);

                if (error) {
                    reject(error);
                } else if (code !== 0 && !options.allowFailure) {
                    reject(new Error(`SSH command exited with status ${code}. ${stderr.slice(-2000)}`));
                } else {
                    resolve({code, stdout, stderr});
                }
            };
            const disconnected = () => finish(new Error('SSH connection closed before command completion. Remote process state is unknown.'));
            const abort = () => {
                try {
                    channel?.signal('TERM');
                } catch { /* Server may reject signals. */ }

                channel?.close();
                finish(new Error('SSH command cancelled or timed out. The remote process may still be running.'));
            };

            signal.addEventListener('abort', abort, {once: true});
            this.client.once('close', disconnected);
            this.client.exec(command, (error, stream) => {
                if (error) {
                    finish(error);

                    return;
                }

                channel = stream;

                if (signal.aborted) {
                    abort();

                    return;
                }

                stream.on('error', finish);
                stream.on('data', (chunk: Buffer) => {
                    const text = chunk.toString();

                    stdout = (stdout + text).slice(-1024 * 1024);
                    this.services.log(text);
                });
                stream.stderr.on('data', (chunk: Buffer) => {
                    pending += chunk.toString();

                    if (password !== undefined && !sent) {
                        if (!pending.includes(marker)) {
                            if (pending.length < 8192) {
                                return;
                            }
                        } else {
                            pending = pending.replace(marker, '');
                            stream.write(password + '\n');
                            sent = true;
                        }
                    }

                    stderr = (stderr + pending).slice(-1024 * 1024);
                    this.services.log(pending);
                    pending = '';
                });
                stream.on('close', (code: number) => {
                    stderr = (stderr + pending.replaceAll(marker, '')).slice(-1024 * 1024);
                    finish(undefined, typeof code === 'number' ? code : -1);
                });
            });
        });
    }

    private async transfer(options: FileTransfer, upload: boolean): Promise<void> {
        const signal = AbortSignal.any([this.services.signal, AbortSignal.timeout(milliseconds(options.timeout ?? '1h'))]);
        const connector = new SftpConnector({
            ...this.config,
            initialPath: '',
            abortSignal: signal,
            hostVerifier: (key: Buffer) => this.services.trust(this.config.host, this.config.port, 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')),
            keyboardInteractive: this.config.keyboardInteractive ? async challenge => Promise.all(challenge.prompts.map((prompt, index) => this.services.ask({id: `ssh-challenge:${index}`, message: prompt.prompt, type: prompt.echo ? 'input' : 'password'}).then(String))) : undefined,
        });

        try {
            await connector.connect();

            if (upload) {
                await connector.write(options.destinationFile,
                    () => createReadStream(absolutePath(this.services.directory, options.sourceFile)),
                    {abortSignal: signal, maxBytes: options.maxBytes});
            } else {
                const destination = absolutePath(this.services.directory, options.destinationFile);
                const temporary = `${destination}.dockline-${randomUUID()}`;

                await mkdir(path.dirname(destination), {recursive: true});

                try {
                    const contents = await connector.read(options.sourceFile, {
                        abortSignal: signal,
                        maxBytes: options.maxBytes,
                    });

                    await pipeline(Buffer.isBuffer(contents) ? Readable.from([contents]) : contents as Readable, createWriteStream(temporary, {flags: 'wx', mode: 0o600}), {signal});
                    await rename(temporary, destination);
                } finally {
                    await unlink(temporary).catch(() => {});
                }
            }
        } finally {
            await connector.disconnect();
        }
    }

    public download(options: FileTransfer): Promise<void> {
        return this.transfer(options, false);
    }

    public upload(options: FileTransfer): Promise<void> {
        return this.transfer(options, true);
    }
}

export class SshClient {
    private readonly services: SshServices;

    public constructor(config: ResolvedSsh, options: Partial<Omit<SshServices, 'resolve'>> = {}) {
        this.services = {
            directory: options.directory ?? process.cwd(),
            signal: options.signal ?? new AbortController().signal,
            log: options.log ?? (() => {}),
            ask: options.ask ?? (async () => {
                throw new Error('This operation requires a credential prompt callback.');
            }),
            trust: options.trust ?? (async () => false),
            resolve: async overrides => {
                const changed = (overrides.host && overrides.host !== config.host) || (overrides.port &&
                    overrides.port !== config.port) || (overrides.username && overrides.username !== config.username);

                return {
                    ...config,
                    ...(changed ? {
                        password: undefined,
                        passphrase: undefined,
                        privateKeyPath: undefined,
                        agent: undefined,
                        hostFingerprint: undefined,
                    } : {}),
                    ...overrides,
                };
            },
        };
    }

    public withConnection<T>(callback: (server: SshSession) => Promise<T>): Promise<T>;
    public withConnection<T>(options: SshOptions, callback: (server: SshSession) => Promise<T>): Promise<T>;
    public async withConnection<T>(
        options: SshOptions | ((server: SshSession) => Promise<T>),
        callback?: (server: SshSession) => Promise<T>,
    ): Promise<T> {
        const config = await this.services.resolve(typeof options === 'function' ? {} : options);
        const action = typeof options === 'function' ? options : callback!;
        const services: SshServices = {
            ...this.services,
            trust: config.hostFingerprint ?
                async (_host, _port, fingerprint) => fingerprint === config.hostFingerprint : this.services.trust,
        };
        const client = new Client();
        const abort = () => client.destroy();

        this.services.signal.addEventListener('abort', abort, {once: true});

        try {
            this.services.signal.throwIfAborted();

            const privateKey = await prepareSshPrivateKey(
                config.privateKeyPath ? await readFile(config.privateKeyPath) : undefined, config.passphrase);

            this.services.signal.throwIfAborted();
            await new Promise<void>((resolve, reject) => {
                client.once('ready', resolve);
                client.on('error', reject);
                client.once('close', () => reject(new Error('SSH connection closed during authentication.')));
                client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
                    void Promise.all(prompts.map((prompt, index) => this.services.ask({id: `ssh-challenge:${index}`, message: prompt.prompt, type: prompt.echo ? 'input' : 'password'}))).then(answers => finish(answers.map(String)), reject);
                });
                void (async () => {
                    client.connect({
                        host: config.host,
                        port: config.port,
                        username: config.username,
                        password: config.password,
                        privateKey,
                        passphrase: config.passphrase,
                        agent: config.agent,
                        tryKeyboard: config.keyboardInteractive,
                        readyTimeout: 60000,
                        hostVerifier: (key: Buffer, verify: (accepted: boolean) => void) => {
                            const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

                            void services.trust(config.host, config.port, fingerprint).then(verify,
                                () => verify(false));
                        },
                    });
                })().catch(reject);
            });

            return await action(new SshSession(client, config, services));
        } finally {
            this.services.signal.removeEventListener('abort', abort);
            client.destroy();
        }
    }
}
