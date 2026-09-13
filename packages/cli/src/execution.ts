import {mkdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {
    Dockline, NotSupportedError, ResourceLimitError, checkAbort, relativeRemotePath,
    type ConnectorOperationOptions, type TransferConfig,
} from '@jalsoedesign/dockline-core';
import {resolveCliCommandDefaults, type CliCommand, type CliCommandDefaults, type LoadedCliConfig} from './config.js';
import type {ResolvedCliContext} from './context.js';
import {CliUsageError} from './errors.js';
import {createCliTrust} from './trust.js';

export interface CliOverrides {
    sourceFile?: string;
    destinationFile?: string;
    path?: string;
    overwrite?: 'fail' | 'replace';
    recursive?: boolean;
}

interface Entry {
    path: string;
    type: string;
    size?: number;
    lastModifiedMs?: number;
    isSymbolicLink?: boolean;
    isUnsupported?: boolean;
}

export type CliResult = {
    ok: true;
    command: 'download' | 'upload';
    sourceFile: string;
    destinationFile: string;
    bytesTransferred: number;
} | {
    ok: true;
    command: 'list';
    path: string;
    entries: Entry[];
    complete: true;
} | {
    ok: true;
    command: 'remove';
    path: string;
    removed: number;
};

interface CommandPlan {
    command: CliCommand;
    connection: TransferConfig;
    settings: CliCommandDefaults;
    options: ConnectorOperationOptions;
    remotePath: string;
    displayPath: string;
    localPath?: string;
}

function requiredPath(value: string | undefined, flag: string): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        throw new CliUsageError(`${flag} is required, either on the command line or in configuration`);
    }

    return value;
}

function planCommand(
    command: CliCommand,
    loaded: LoadedCliConfig,
    overrides: CliOverrides,
    context: ResolvedCliContext,
    json: boolean,
): CommandPlan {
    const settings = {...resolveCliCommandDefaults(loaded, command), ...overrides};
    let connection = {...loaded.connection};
    let displayPath: string;
    let localPath: string | undefined;

    if (command === 'download') {
        displayPath = requiredPath(settings.sourceFile, '--source-file');
        localPath = path.resolve(context.cwd, requiredPath(settings.destinationFile, '--destination-file'));
    } else if (command === 'upload') {
        displayPath = requiredPath(settings.destinationFile, '--destination-file');
        localPath = path.resolve(context.cwd, requiredPath(settings.sourceFile, '--source-file'));
    } else {
        displayPath = command === 'list' ? settings.path ?? '.' : requiredPath(settings.path, '--path');
    }

    if (displayPath.startsWith('/')) {
        connection.root = '/';
    }

    let remotePath: string;

    try {
        remotePath = relativeRemotePath(displayPath.replace(/^\/+/, ''), command === 'list');
    } catch (error) {
        throw new CliUsageError(error instanceof Error ? error.message : 'Invalid remote path');
    }

    if (connection.protocol === 'sftp') {
        connection = {...connection, ...createCliTrust(connection, loaded.trust, context, json)};
    }

    connection.abortSignal = context.signal;

    const options: ConnectorOperationOptions = {abortSignal: context.signal};

    for (const name of [
        'autoReconnect',
        'maxTransientRetries',
        'timeoutMs',
        'maxBytes',
        'bandwidth',
    ] as const) {
        if (settings[name] !== undefined) {
            Object.assign(options, {[name]: settings[name]});
        }
    }

    return {
        command,
        connection,
        settings,
        options,
        remotePath,
        displayPath,
        localPath,
    };
}

function safeEntry(entry: Entry): Entry {
    return {
        path: entry.path,
        type: entry.type,
        ...(entry.size === undefined ? {} : {size: entry.size}),
        ...(entry.lastModifiedMs === undefined ? {} : {lastModifiedMs: entry.lastModifiedMs}),
        ...(entry.isSymbolicLink ? {isSymbolicLink: true} : {}),
        ...(entry.isUnsupported ? {isUnsupported: true} : {}),
    };
}

async function collectEntries(remote: Dockline, plan: CommandPlan, recursive: boolean): Promise<Entry[]> {
    const entries: Entry[] = [];
    const options = {
        ...plan.options,
        maxDepth: plan.settings.maxDepth ?? 32,
        maxEntries: plan.settings.maxEntries ?? 100000,
    };

    if (recursive) {
        const traversal = remote.walk(plan.remotePath, options);

        for await (const entry of traversal.entries) {
            entries.push(safeEntry(entry));
        }

        const result = await traversal.result;

        if (!result.complete) {
            throw new ResourceLimitError(`Directory traversal is incomplete (${result.reason}); adjust the config traversal limits`);
        }
    } else {
        for await (const entry of remote.list(plan.remotePath, plan.options)) {
            if (entries.length >= options.maxEntries) {
                throw new ResourceLimitError('Directory listing exceeds maxEntries; adjust the config traversal limit');
            }

            entries.push(safeEntry(entry));
        }
    }

    return entries;
}

function requireRemovable(entry: Entry): void {
    if (entry.isSymbolicLink || entry.isUnsupported || !['file', 'directory'].includes(entry.type)) {
        throw new NotSupportedError('Removal of symbolic links and special remote entries is unsupported');
    }
}

async function remove(remote: Dockline, plan: CommandPlan): Promise<number> {
    const target = await remote.stat(plan.remotePath, plan.options);

    requireRemovable(target);

    if (target.type === 'file') {
        await remote.deleteFile(plan.remotePath, plan.options);

        return 1;
    }

    if (!plan.settings.recursive) {
        await remote.connector.removeEmptyDirectory(plan.remotePath, plan.options);

        return 1;
    }

    const entries = await collectEntries(remote, plan, true);
    const paths = new Set<string>();

    // Validate the complete inventory before the first mutation. Directory deletion remains non-recursive.
    for (const entry of entries) {
        requireRemovable(entry);

        const normalized = relativeRemotePath(entry.path);

        if (!normalized.startsWith(plan.remotePath + '/') || paths.has(normalized)) {
            throw new NotSupportedError('The server returned an unsafe or duplicate removal path');
        }

        paths.add(normalized);
        entry.path = normalized;
    }

    entries.sort((left, right) => right.path.split('/').length - left.path.split('/').length);

    for (const entry of entries) {
        checkAbort(plan.options.abortSignal);

        const current = await remote.stat(entry.path, plan.options);

        requireRemovable(current);

        if (current.type !== entry.type) {
            throw new NotSupportedError('A remote entry changed type during removal');
        }

        if (entry.type === 'directory') {
            await remote.connector.removeEmptyDirectory(entry.path, plan.options);
        } else {
            await remote.deleteFile(entry.path, plan.options);
        }
    }

    await remote.connector.removeEmptyDirectory(plan.remotePath, plan.options);

    return entries.length + 1;
}

async function runConnected(remote: Dockline, plan: CommandPlan): Promise<CliResult> {
    if (plan.command === 'list') {
        const entries = await collectEntries(remote, plan, plan.settings.recursive ?? false);

        return {
            ok: true,
            command: 'list',
            path: plan.displayPath,
            entries,
            complete: true,
        };
    }

    if (plan.command === 'remove') {
        const removed = await remove(remote, plan);

        return {
            ok: true,
            command: 'remove',
            path: plan.displayPath,
            removed,
        };
    }

    const localPath = plan.localPath!;

    if (plan.command === 'download') {
        await mkdir(path.dirname(localPath), {recursive: true});
        await remote.downloadFile(plan.remotePath, localPath, {
            ...plan.options,
            overwrite: plan.settings.overwrite ?? 'fail',
        });
    } else {
        await remote.uploadFile(localPath, plan.remotePath, {
            ...plan.options,
            overwrite: plan.settings.overwrite ?? 'replace',
        });
    }

    const metadata = await stat(localPath);

    return {
        ok: true,
        command: plan.command,
        sourceFile: plan.command === 'download' ? plan.displayPath : localPath,
        destinationFile: plan.command === 'download' ? localPath : plan.displayPath,
        bytesTransferred: metadata.size,
    };
}

export async function executeCommand(
    command: CliCommand,
    config: LoadedCliConfig,
    overrides: CliOverrides,
    context: ResolvedCliContext,
    json: boolean,
): Promise<CliResult> {
    checkAbort(context.signal);

    const plan = planCommand(command, config, overrides, context, json);

    if (command === 'upload') {
        try {
            if (!(await stat(plan.localPath!)).isFile()) {
                throw new Error('Not a regular file');
            }
        } catch {
            throw new CliUsageError('--source-file must name a readable regular local file');
        }
    }

    const remote = Dockline.create(plan.connection);

    if (command === 'upload' && plan.settings.overwrite === 'fail') {
        try {
            remote.connector.validatePublicationOptions({...plan.options, overwrite: 'fail'});
        } catch (error) {
            throw new CliUsageError(error instanceof Error ? error.message : 'Unsupported overwrite policy');
        }
    }

    let result: CliResult;

    try {
        await remote.connect(plan.options);
        result = await runConnected(remote, plan);
    } catch (error) {
        await remote.disconnect().catch(cleanup => {
            throw new AggregateError([error, cleanup], 'Operation and connection cleanup failed');
        });

        throw error;
    }

    await remote.disconnect();

    return result;
}
