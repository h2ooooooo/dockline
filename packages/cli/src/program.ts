import {createRequire} from 'node:module';
import {Command, CommanderError, Option} from 'commander';
import {OperationAbortedError} from '@dockline/core';
import {CliConfigError, loadCliConfig, type CliCommand} from './config.js';
import {resolveContext, type CliContext, type ResolvedCliContext} from './context.js';
import {CliUsageError, redactText, terminalText} from './errors.js';
import {executeCommand, type CliOverrides, type CliResult} from './execution.js';

interface RunState {
    command?: CliCommand;
    json: boolean;
    quiet: boolean;
    secrets: string[];
}

function printResult(result: CliResult, state: RunState, context: ResolvedCliContext): void {
    if (state.json) {
        context.stdout.write(JSON.stringify(result) + '\n');

        return;
    }

    if (result.command === 'list') {
        for (const entry of result.entries) {
            const type = entry.isSymbolicLink ? 'link' : entry.isUnsupported ? 'special' : entry.type;

            context.stdout.write(`${type}\t${entry.size ?? '-'}\t${terminalText(entry.path)}\n`);
        }

        return;
    }

    if (state.quiet) {
        return;
    }

    if (result.command === 'remove') {
        context.stdout.write(`Removed ${result.removed} remote ${result.removed === 1 ? 'entry' : 'entries'}: ${terminalText(result.path)}\n`);
    } else {
        const verb = result.command === 'download' ? 'Downloaded' : 'Uploaded';

        context.stdout.write(`${verb} ${result.bytesTransferred} bytes: ${terminalText(result.sourceFile)} -> ${terminalText(result.destinationFile)}\n`);
    }
}

function buildProgram(context: ResolvedCliContext, state: RunState): Command {
    const manifest = createRequire(import.meta.url)('../package.json') as {version: string};
    const program = new Command();

    program.name('dockline')
        .description('Transfer files over FTP, FTPS and SFTP using an installed Dockline client.')
        .version(manifest.version)
        .option('-c, --config <file>', 'YAML server configuration', 'dockline.server.yml')
        .option('--json', 'write one structured JSON result')
        .option('--quiet', 'suppress human success output; keep list data and errors')
        .exitOverride()
        .configureHelp({showGlobalOptions: true})
        .configureOutput({
            writeOut: text => context.stdout.write(text),
            writeErr: text => context.stderr.write(text),
            outputError: () => {},
        });

    for (const name of ['download', 'upload', 'list', 'remove'] as const) {
        const descriptions = {
            download: 'Download one remote file to a local file',
            upload: 'Upload one local file to a remote file',
            list: 'List remote directory entries',
            remove: 'Remove a remote file or directory',
        };
        const command = program.command(name).description(descriptions[name]);

        if (name === 'download' || name === 'upload') {
            command.option('-s, --source-file <file>', name === 'download' ? 'remote source file' : 'local source file')
                .option('-d, --destination-file <file>', name === 'download' ? 'local destination file' : 'remote destination file')
                .addOption(new Option('--overwrite <policy>', `existing destination policy (default: ${name === 'download' ? 'fail' : 'replace'})`).choices(['fail', 'replace']));
        } else {
            command.option('-p, --path <path>', name === 'list' ? 'remote directory (default: .)' : 'remote file or directory')
                .option('-r, --recursive', 'include nested directories')
                .option('--no-recursive', 'disable recursive mode from configuration');
        }

        command.action(async () => {
            const options = command.optsWithGlobals();

            state.command = name;
            state.json = options.json === true;
            state.quiet = options.quiet === true;

            const config = await loadCliConfig(options.config, {cwd: context.cwd, env: context.env});

            state.secrets = [
                config.connection.password,
                ...(config.connection.protocol === 'sftp' ? [
                    config.connection.passphrase,
                    config.connection.privateKey,
                    config.connection.keyboardInteractive,
                ] : []),
            ].filter((value): value is string => typeof value === 'string' && value.length > 0);

            const overrides: CliOverrides = {};

            for (const field of [
                'sourceFile',
                'destinationFile',
                'path',
                'overwrite',
                'recursive',
            ] as const) {
                if (command.getOptionValueSource(field) === 'cli') {
                    Object.assign(overrides, {[field]: options[field]});
                }
            }

            const result = await executeCommand(name, config, overrides, context, state.json);

            printResult(result, state, context);
        });
    }

    program.action(() => {
        throw new CliUsageError('Choose a command: download, upload, list or remove. Use --help for usage');
    });

    program.addHelpText('after', '\nInstall @dockline/ftp-client for FTP/FTPS or @dockline/sftp-client for SFTP.\nAdvanced connection, retry, bandwidth and limit settings belong in the YAML config.');

    return program;
}

/** Build a fresh Commander program. Embedders control parsing and error handling. */
export function createProgram(context: CliContext = {}): Command {
    return buildProgram(resolveContext(context), {json: false, quiet: false, secrets: []});
}

/** Run without terminating the process or registering process-wide signal handlers. */
export async function runCli(
    argv: readonly string[] = process.argv.slice(2),
    context: CliContext = {},
): Promise<number> {
    const resolved = resolveContext(context);
    const state: RunState = {json: argv.includes('--json'), quiet: false, secrets: []};
    const program = buildProgram(resolved, state);

    try {
        if (argv.length === 0) {
            program.outputHelp();

            return 0;
        }

        await program.parseAsync([...argv], {from: 'user'});

        return 0;
    } catch (error) {
        if (error instanceof CommanderError && error.exitCode === 0) {
            return 0;
        }

        const cancelled = resolved.signal?.aborted || error instanceof OperationAbortedError ||
            (error instanceof Error && error.name === 'AbortError');
        const usage = error instanceof CommanderError || error instanceof CliConfigError ||
            error instanceof CliUsageError;
        const exitCode = cancelled ? 130 : usage ? 2 : 1;
        const code = cancelled ? 'ABORT_ERR' : error instanceof CliConfigError ? 'DOCKLINE_CONFIG_ERROR' :
            error instanceof Error && 'code' in error && error.code !== undefined ? String(error.code) :
                error instanceof Error ? error.name : 'DOCKLINE_ERROR';
        const message = redactText(cancelled ? 'The operation was cancelled' :
            error instanceof Error ? error.message.replace(/^error: /, '') : 'The operation failed', state.secrets);

        if (state.json) {
            resolved.stdout.write(JSON.stringify({
                ok: false,
                ...(state.command ? {command: state.command} : {}),
                error: {code, message},
            }) + '\n');
        } else {
            resolved.stderr.write(`dockline: ${terminalText(message)}\n`);
        }

        return exitCode;
    }
}
