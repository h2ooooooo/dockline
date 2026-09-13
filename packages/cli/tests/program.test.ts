import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createProgram, runCli} from '../src/program.js';
import {redactText, terminalText} from '../src/errors.js';

let directory: string;

function streams() {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let output = '';
    let errors = '';

    stdout.on('data', chunk => {
        output += chunk;
    });
    stderr.on('data', chunk => {
        errors += chunk;
    });

    return {context: {stdout, stderr, cwd: directory}, output: () => output, errors: () => errors};
}

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'dockline-cli-program-'));

    await writeFile(path.join(directory, 'dockline.server.yml'), JSON.stringify({
        connection: {protocol: 'ftp', host: '127.0.0.1', username: 'test'},
    }));
});

afterAll(async () => {
    const target = path.resolve(directory);

    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('dockline-cli-program-')) {
        throw new Error('Unexpected CLI test directory');
    }

    await rm(target, {recursive: true, force: true});
});

describe('CLI embedding and command parsing', () => {
    it.each([[], ['--help'], ['download', '--help'], ['--version']].map(argv => [argv]))('shows help/version without a config: %j', async argv => {
        const io = streams();

        expect(await runCli(argv, {...io.context, cwd: path.join(directory, 'missing')})).toBe(0);
        expect(io.output().length).toBeGreaterThan(0);
        expect(io.errors()).toBe('');
    });

    it('documents shared flags in command help', async () => {
        const io = streams();

        expect(await runCli(['download', '--help'], io.context)).toBe(0);
        expect(io.output()).toContain('--config');
        expect(io.output()).toContain('--source-file');
        expect(io.output()).toContain('--json');
    });

    it.each([
        ['unknown', '--json'],
        ['--json'],
        ['--quiet', '--json'],
        ['download', '--overwrite', 'sometimes', '--json'],
        ['download', '-s', 'source', '--json'],
        ['remove', '-p', '../parent', '--json'],
        ['remove', '-p', '/', '--json'],
        ['list', '--unknown', '--json'],
        [
            'download',
            '-s',
            'source',
            '-d',
            '--json',
        ],
    ].map(argv => [argv]))('produces one structured usage error: %j', async argv => {
        const io = streams();

        expect(await runCli(argv, io.context)).toBe(2);
        expect(JSON.parse(io.output())).toMatchObject({ok: false, error: {code: expect.any(String)}});
        expect(io.errors()).toBe('');
    });

    it('supports globals before the command and never exits its embedding process', async () => {
        const io = streams();
        const signalHandlers = process.listenerCount('SIGINT');

        expect(await runCli(['--json', '--config', 'dockline.server.yml', 'download'], io.context)).toBe(2);
        expect(JSON.parse(io.output())).toMatchObject({ok: false, command: 'download'});
        expect(process.listenerCount('SIGINT')).toBe(signalHandlers);
    });

    it('returns cancellation with a caller-owned abort signal', async () => {
        const io = streams();

        expect(await runCli(['list', '--json'], {...io.context, signal: AbortSignal.abort()})).toBe(130);
        expect(JSON.parse(io.output())).toMatchObject({ok: false, error: {code: 'ABORT_ERR'}});
    });

    it('writes human errors to stderr even in quiet mode', async () => {
        const io = streams();

        expect(await runCli(['download', '--quiet'], io.context)).toBe(2);
        expect(io.output()).toBe('');
        expect(io.errors()).toContain('--source-file');
    });

    it('creates independently configurable Commander programs', () => {
        const first = createProgram(streams().context);
        const second = createProgram(streams().context);

        first.command('custom').description('An application-owned command');
        expect(first.commands.map(command => command.name())).toContain('custom');
        expect(second.commands.map(command => command.name())).not.toContain('custom');
    });

    it('escapes terminal controls and redacts overlapping credential strings', () => {
        expect(terminalText('remote\x1b[31m\nfile')).toBe('remote\\u001b[31m\\u000afile');
        expect(redactText('token-long token', ['token', 'token-long'])).toBe('[redacted] [redacted]');
    });
});
