import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CliConfigError, loadCliConfig, resolveCliCommandDefaults} from '../src/config.js';

let directory: string;
let configurationDirectory: string;
const connection = 'connection:\n  protocol: sftp\n  host: fixture.invalid\n  username: fixture\n';

async function writeConfig(contents: string | Buffer): Promise<string> {
    const filename = path.join(configurationDirectory, 'site.yml');

    await writeFile(filename, contents);

    return filename;
}

beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'dockline-cli-config-'));
    configurationDirectory = path.join(directory, 'profiles');
    await mkdir(configurationDirectory);
});

afterEach(async () => {
    const resolved = path.resolve(directory);

    if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('dockline-cli-config-')
    ) {
        throw new Error('Refusing to remove an unexpected test directory');
    }

    await rm(resolved, {recursive: true, force: true});
});

describe('CLI YAML configuration', () => {
    it('keeps operation defaults absent and never loads optional clients', async () => {
        const filename = await writeConfig(connection);
        const loaded = await loadCliConfig(filename);

        expect(loaded).toEqual({
            connection: {protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'},
            trust: undefined,
            defaults: {},
            commands: {},
            configFile: filename,
        });
        expect(loaded.connection).not.toHaveProperty('maxBytes');
    });

    it('expands environment values after parsing without injecting YAML or disclosing secrets', async () => {
        const secret = 'private: value\nhost: injected.invalid';
        const filename = await writeConfig(`${connection}  password: "\${PASSWORD}"\n  port: "\${PORT}"\n`);
        const loaded = await loadCliConfig(filename, {env: {PASSWORD: secret, PORT: '2222'}});

        expect(loaded.connection.password).toBe(secret);
        expect(loaded.connection.host).toBe('fixture.invalid');
        expect(loaded.connection.port).toBe(2222);
    });

    it('rejects missing environment variables and ignores inherited environment properties', async () => {
        const filename = await writeConfig(`${connection}  password: "\${PASSWORD}"\n`);

        await expect(loadCliConfig(filename, {env: {}})).rejects.toThrow('Missing environment variable PASSWORD');
        await expect(loadCliConfig(filename, {env: Object.create({PASSWORD: 'inherited-secret'})})).rejects.toThrow(CliConfigError);
    });

    it.each(['unlimited', '.inf', '0', '"0"'])('accepts the explicit byte budget %s', async value => {
        const filename = await writeConfig(`${connection}  maxBytes: ${value}\n`);
        const loaded = await loadCliConfig(filename);

        expect(loaded.connection.maxBytes).toBe(value.includes('0') ? 0 : Infinity);
    });

    it('keeps connection, shared and per-command budgets separate before the executor merges them', async () => {
        const filename = await writeConfig(`${connection}  maxBytes: 20\ndefaults:\n  maxBytes: 10\n  timeoutMs: 1000\ncommands:\n  download:\n    maxBytes: unlimited\n  upload:\n    maxBytes: 0\n`);
        const loaded = await loadCliConfig(filename);

        expect(loaded.connection.maxBytes).toBe(20);
        expect(loaded.defaults.maxBytes).toBe(10);
        expect(resolveCliCommandDefaults(loaded, 'download')).toEqual({maxBytes: Infinity, timeoutMs: 1000});
        expect(resolveCliCommandDefaults(loaded, 'upload')).toEqual({maxBytes: 0, timeoutMs: 1000});
    });

    it('resolves configuration paths against the config directory and preserves remote paths', async () => {
        await writeConfig(`${connection}  privateKeyPath: ../keys/id_ed25519\n  trust:\n    knownHostsFile: ../trust/hosts.json\ndefaults:\n  sourceFile: common-source.bin\n  destinationFile: common-destination.bin\ncommands:\n  download:\n    sourceFile: remote/source.bin\n    destinationFile: downloads/result.bin\n  upload:\n    sourceFile: uploads/source.bin\n    destinationFile: remote/result.bin\n`);

        const loaded = await loadCliConfig('profiles/site.yml', {cwd: directory});

        expect((loaded.connection as any).privateKeyPath).toBe(path.join(directory, 'keys', 'id_ed25519'));
        expect(loaded.trust?.knownHostsFile).toBe(path.join(directory, 'trust', 'hosts.json'));
        expect(resolveCliCommandDefaults(loaded, 'download')).toMatchObject({
            sourceFile: 'remote/source.bin',
            destinationFile: path.join(configurationDirectory, 'downloads', 'result.bin'),
        });
        expect(resolveCliCommandDefaults(loaded, 'upload')).toMatchObject({
            sourceFile: path.join(configurationDirectory, 'uploads', 'source.bin'),
            destinationFile: 'remote/result.bin',
        });
    });

    it('resolves shared local defaults only after selecting their command', async () => {
        const filename = await writeConfig(`${connection}defaults:\n  sourceFile: source.bin\n  destinationFile: destination.bin\n`);
        const loaded = await loadCliConfig(filename);

        expect(loaded.defaults).toEqual({sourceFile: 'source.bin', destinationFile: 'destination.bin'});
        expect(resolveCliCommandDefaults(loaded, 'download')).toEqual({
            sourceFile: 'source.bin',
            destinationFile: path.join(configurationDirectory, 'destination.bin'),
        });
        expect(resolveCliCommandDefaults(loaded, 'upload')).toEqual({
            sourceFile: path.join(configurationDirectory, 'source.bin'),
            destinationFile: 'destination.bin',
        });
    });

    it('loads a config-relative PEM bundle into explicit FTPS TLS options', async () => {
        const certificate = await readFile(new URL('../../ftp-client/tests/fixtures/localhost-test-cert.pem', import.meta.url), 'utf8');

        await writeFile(path.join(configurationDirectory, 'ca.pem'), certificate);

        const filename = await writeConfig('connection:\n  protocol: ftps\n  host: fixture.invalid\n  username: anonymous\n  secureOptions:\n    caFile: ca.pem\n    servername: localhost\n    minVersion: TLSv1.3\n    rejectUnauthorized: true\n');
        const loaded = await loadCliConfig(filename);

        expect((loaded.connection as any).secureOptions).toEqual({
            ca: certificate,
            servername: 'localhost',
            minVersion: 'TLSv1.3',
            rejectUnauthorized: true,
        });
    });

    it('validates the complete YAML schema before opening a referenced CA file', async () => {
        const filename = await writeConfig('connection:\n  protocol: ftps\n  host: fixture.invalid\n  username: anonymous\n  secureOptions:\n    caFile: missing.pem\ncommands:\n  upload:\n    misspelledOption: true\n');

        await expect(loadCliConfig(filename)).rejects.toThrow('commands.upload contains an unknown or unsupported field');
    });

    it('extracts canonical host fingerprints without putting trust callbacks into the connection', async () => {
        const fingerprint = `SHA256:${Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')}`;
        const filename = await writeConfig(`${connection}  trust:\n    fingerprint: ${fingerprint}\n`);
        const loaded = await loadCliConfig(filename);

        expect(loaded.trust).toEqual({fingerprint});
        expect(loaded.connection).not.toHaveProperty('trust');
        expect(loaded.connection).not.toHaveProperty('hostVerifier');
    });

    it.each([
        `${connection}  trust:\n    fingerprint: SHA256:short\n`,
        `${connection}  trust:\n    fingerprint: SHA256:${'A'.repeat(42)}B\n`,
        `${connection}  trust:\n    fingerprint: SHA256:${'A'.repeat(43)}\n    knownHostsFile: hosts.json\n`,
        `${connection}  port: null\n`,
        `${connection}  maxBytes: -1\n`,
        `${connection}  maxBytes: .nan\n`,
        `${connection}  maxBytes: 1.5\n`,
        `${connection}  maxBytes: 9007199254740992\n`,
        `${connection}  timeoutMs: 2147483648\n`,
        `${connection}  autoReconnect: "true"\n`,
        `${connection}  hostVerifier: true\n`,
        `${connection}  credentialProvider: true\n`,
        `${connection}  requireTrustPolicy: false\n`,
        `${connection}  secureOptions: {}\n`,
        `${connection}  filenameEncoding:\n    charset: latin1\n`,
        `${connection}  keepalive:\n    intervalMs: 10\n    maxMissed: 0\n`,
        `${connection}commands:\n  download:\n    path: wrong-command-field\n`,
        `${connection}commands:\n  remove:\n    overwrite: replace\n`,
        `${connection}commands:\n  typo: {}\n`,
        `${connection}defaults:\n  timeotMs: 10\n`,
        `${connection}unknown: true\n`,
        `version: 2\n${connection}`,
    ])('rejects invalid or unsupported schema values without exposing their values', async contents => {
        const filename = await writeConfig(contents);

        await expect(loadCliConfig(filename)).rejects.toThrow(CliConfigError);
    });

    it.each([
        `${connection}  host: duplicate-secret.invalid\n`,
        `${connection}  password: !secret private-value\n`,
        `${connection}  password: &secret private-value\n  passphrase: *secret\n`,
        `${connection}  password: [private-value]\n`,
        `${connection}  password: null\n`,
        `${connection}  __proto__: {private-value: true}\n`,
        `${connection}  constructor: private-value\n`,
        `${connection}  prototype: private-value\n`,
        `${connection}  password: [private-value\n`,
        `${connection}---\nprivate-value: true\n`,
        '%YAML 1.1\n---\n' + connection,
    ])('rejects unsafe YAML without echoing parser excerpts', async contents => {
        const filename = await writeConfig(contents);

        try {
            await loadCliConfig(filename);
            expect.fail('Invalid YAML was accepted');
        } catch (error) {
            expect(error).toBeInstanceOf(CliConfigError);
            expect(String(error)).not.toContain('private-value');
            expect(String(error)).not.toContain('duplicate-secret');
        }
    });

    it('rejects oversized configuration, directories and invalid UTF-8', async () => {
        const filename = await writeConfig(Buffer.alloc(1048577, 32));

        await expect(loadCliConfig(filename)).rejects.toThrow(CliConfigError);
        await expect(loadCliConfig(configurationDirectory)).rejects.toThrow(CliConfigError);
        await writeConfig(Buffer.from([0xff, 0xfe]));
        await expect(loadCliConfig(filename)).rejects.toThrow(CliConfigError);
    });
});
