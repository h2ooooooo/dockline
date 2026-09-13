import {open, stat} from 'node:fs/promises';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import type {ConnectionOptions} from 'node:tls';
import {isAlias, isMap, isScalar, isSeq, parseDocument, visit} from 'yaml';
import {
    resolveOperationOptions, validateTransferConfig,
    type ConnectorOperationOptions, type TransferConfig, type FtpTransferConfig, type SftpTransferConfig,
} from '@dockline/core';

export type CliCommand = 'download' | 'upload' | 'list' | 'remove';

export interface CliCommandOptions extends Pick<ConnectorOperationOptions,
    'autoReconnect' | 'maxTransientRetries' | 'timeoutMs' | 'maxBytes'> {
    bandwidth?: number;
}

export interface CliCommandDefaults extends CliCommandOptions {
    sourceFile?: string;
    destinationFile?: string;
    path?: string;
    overwrite?: 'fail' | 'replace';
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
}

export interface CliTrustConfig {
    fingerprint?: string;
    knownHostsFile?: string;
}

export interface LoadedCliConfig {
    connection: TransferConfig;
    trust?: CliTrustConfig;
    defaults: CliCommandDefaults;
    commands: Partial<Record<CliCommand, CliCommandDefaults>>;
    configFile: string;
}

export class CliConfigError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'CliConfigError';
    }
}

const MAX_CONFIG_BYTES = 1048576;
const commandNames: CliCommand[] = ['download', 'upload', 'list', 'remove'];
const operationFields = [
    'autoReconnect',
    'maxTransientRetries',
    'timeoutMs',
    'maxBytes',
    'bandwidth',
];
const commandFields = [
    ...operationFields,
    'sourceFile',
    'destinationFile',
    'path',
    'overwrite',
    'recursive',
    'maxDepth',
    'maxEntries',
];
const commonConnectionFields = [
    ...operationFields,
    'protocol',
    'host',
    'username',
    'password',
    'port',
    'root',
    'timeout',
    'siteId',
    'keepalive',
    'filenameEncoding',
];
const ftpConnectionFields = [...commonConnectionFields, 'passive', 'secureOptions'];
const sftpConnectionFields = [
    ...commonConnectionFields,
    'privateKey',
    'privateKeyPath',
    'passphrase',
    'agent',
    'agentForward',
    'readyTimeout',
    'keyboardInteractive',
    'trust',
];

async function readConfigText(filename: string): Promise<string> {
    let handle;

    try {
        const preliminary = await stat(filename);

        if (!preliminary.isFile() || preliminary.size > MAX_CONFIG_BYTES) {
            throw new CliConfigError('Configuration files must be regular files of at most 1 MiB');
        }

        handle = await open(filename, 'r');

        const metadata = await handle.stat();

        if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES) {
            throw new CliConfigError('Configuration files must be regular files of at most 1 MiB');
        }

        const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
        let bytes = 0;

        while (bytes < buffer.length) {
            const result = await handle.read(buffer, bytes, buffer.length - bytes, null);

            if (result.bytesRead === 0) {
                break;
            }

            bytes += result.bytesRead;
        }

        if (bytes > MAX_CONFIG_BYTES) {
            throw new CliConfigError('Configuration files must be regular files of at most 1 MiB');
        }

        return new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytes));
    } catch (error) {
        if (error instanceof CliConfigError) {
            throw error;
        }

        throw new CliConfigError('Unable to read the configuration as a regular UTF-8 file');
    } finally {
        await handle?.close();
    }
}

function parseConfig(text: string, environment: NodeJS.ProcessEnv): unknown {
    try {
        const document = parseDocument(text, {
            version: '1.2',
            schema: 'core',
            customTags: [],
            resolveKnownTags: false,
            merge: false,
            uniqueKeys: true,
            prettyErrors: false,
        });

        if (document.errors.length || document.warnings.length || document.directives.yaml.version !== '1.2') {
            throw new CliConfigError('Configuration must contain one valid YAML 1.2 document with unique keys');
        }

        visit(document, (_key, node) => {
            if (isAlias(node) || isSeq(node)) {
                throw new CliConfigError('YAML aliases and sequences are not supported in configuration');
            }

            if ((isMap(node) || isScalar(node)) && (node.anchor || node.tag)) {
                throw new CliConfigError('YAML anchors and explicit tags are not supported in configuration');
            }

            if (isMap(node)) {
                for (const pair of node.items) {
                    if (
                        !isScalar(pair.key) ||
                        typeof pair.key.value !== 'string' ||
                        ['__proto__', 'prototype', 'constructor', '<<'].includes(pair.key.value)
                    ) {
                        throw new CliConfigError('Configuration keys must be plain strings without prototype or merge keys');
                    }
                }
            }

            if (isScalar(node) && node.value === null) {
                throw new CliConfigError('Configuration values cannot be null');
            }
        });

        const parsed: unknown = document.toJS({maxAliasCount: 0});

        return expandEnvironment(parsed, environment);
    } catch (error) {
        if (error instanceof CliConfigError) {
            throw error;
        }

        throw new CliConfigError('Unable to parse the YAML configuration');
    }
}

function expandEnvironment(value: unknown, environment: NodeJS.ProcessEnv): unknown {
    if (typeof value === 'string') {
        return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
            const replacement = Object.hasOwn(environment, name) ? environment[name] : undefined;

            if (typeof replacement !== 'string') {
                throw new CliConfigError(`Missing environment variable ${name}`);
            }

            return replacement;
        });
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value).map(([key, entry]) => [key, expandEnvironment(entry, environment)]);

        return Object.fromEntries(entries);
    }

    return value;
}

function mapping(value: unknown, location: string, fields: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CliConfigError(`${location} must be a mapping`);
    }

    const entries = Object.entries(value);

    if (entries.some(([key]) => !fields.includes(key))) {
        throw new CliConfigError(`${location} contains an unknown or unsupported field`);
    }

    return Object.fromEntries(entries);
}

function stringValue(value: unknown, location: string, allowEmpty = false): string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.includes('\0')) {
        throw new CliConfigError(`${location} must be a ${allowEmpty ? 'valid' : 'non-empty'} string`);
    }

    return value;
}

function booleanValue(value: unknown, location: string): boolean {
    if (typeof value !== 'boolean') {
        throw new CliConfigError(`${location} must be a boolean`);
    }

    return value;
}

function integerValue(value: unknown, location: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new CliConfigError(`${location} must be an integer from ${minimum} to ${maximum}`);
    }

    return number;
}

function operationOptions(source: Record<string, unknown>, location: string): CliCommandOptions {
    const result: CliCommandOptions = {};

    if (source.autoReconnect !== undefined) {
        result.autoReconnect = booleanValue(source.autoReconnect, `${location}.autoReconnect`);
    }

    if (source.maxTransientRetries !== undefined) {
        result.maxTransientRetries = integerValue(source.maxTransientRetries, `${location}.maxTransientRetries`);
    }

    if (source.timeoutMs !== undefined) {
        result.timeoutMs = integerValue(source.timeoutMs, `${location}.timeoutMs`, 0, 2147483647);
    }

    if (source.maxBytes !== undefined) {
        result.maxBytes = source.maxBytes === Infinity || source.maxBytes === 'unlimited' ? Infinity :
            integerValue(source.maxBytes, `${location}.maxBytes`);
    }

    if (source.bandwidth !== undefined) {
        result.bandwidth = integerValue(source.bandwidth, `${location}.bandwidth`, 1);
    }

    return result;
}

function commandDefaults(value: unknown, location: string, command?: CliCommand): CliCommandDefaults {
    const selectedFields = command === 'download' || command === 'upload' ?
        [...operationFields, 'sourceFile', 'destinationFile', 'overwrite'] :
        command ? [
            ...operationFields,
            'path',
            'recursive',
            'maxDepth',
            'maxEntries',
        ] : commandFields;
    const source = mapping(value, location, selectedFields);
    const result: CliCommandDefaults = operationOptions(source, location);

    for (const name of ['sourceFile', 'destinationFile', 'path'] as const) {
        if (source[name] !== undefined) {
            result[name] = stringValue(source[name], `${location}.${name}`);
        }
    }

    if (source.overwrite !== undefined) {
        if (source.overwrite !== 'fail' && source.overwrite !== 'replace') {
            throw new CliConfigError(`${location}.overwrite must be fail or replace`);
        }

        result.overwrite = source.overwrite;
    }

    if (source.recursive !== undefined) {
        result.recursive = booleanValue(source.recursive, `${location}.recursive`);
    }

    for (const name of ['maxDepth', 'maxEntries'] as const) {
        if (source[name] !== undefined) {
            result[name] = integerValue(source[name], `${location}.${name}`);
        }
    }

    return result;
}

function trustConfig(value: unknown, directory: string): CliTrustConfig {
    const source = mapping(value, 'connection.trust', ['fingerprint', 'knownHostsFile']);
    const result: CliTrustConfig = {};

    if (source.fingerprint !== undefined && source.knownHostsFile !== undefined) {
        throw new CliConfigError('connection.trust must choose either fingerprint or knownHostsFile');
    }

    if (source.fingerprint !== undefined) {
        const fingerprint = stringValue(source.fingerprint, 'connection.trust.fingerprint');
        const digest = fingerprint.slice(7);

        if (
            !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint) ||
            Buffer.from(digest, 'base64').toString('base64').replace(/=+$/, '') !== digest
        ) {
            throw new CliConfigError('connection.trust.fingerprint must be an OpenSSH SHA256 fingerprint');
        }

        result.fingerprint = fingerprint;
    }

    if (source.knownHostsFile !== undefined) {
        result.knownHostsFile = path.resolve(directory, stringValue(source.knownHostsFile, 'connection.trust.knownHostsFile'));
    }

    return result;
}

function filenameEncoding(value: unknown, sftp: boolean): {charset: string; onUnrepresentable?: 'reject'} {
    const source = mapping(value, 'connection.filenameEncoding', ['charset', 'onUnrepresentable']);
    const charset = stringValue(source.charset, 'connection.filenameEncoding.charset');
    const normalized = charset.toLowerCase().replace(/-/g, '');

    if (!(sftp ? ['utf8'] : ['utf8', 'ascii', 'latin1', 'iso88591']).includes(normalized)) {
        throw new CliConfigError('connection.filenameEncoding.charset is unsupported for this protocol');
    }

    if (source.onUnrepresentable !== undefined && source.onUnrepresentable !== 'reject') {
        throw new CliConfigError('connection.filenameEncoding.onUnrepresentable must be reject');
    }

    return {charset, ...(source.onUnrepresentable === 'reject' ? {onUnrepresentable: 'reject' as const} : {})};
}

function tlsOptions(value: unknown, directory: string): {options: ConnectionOptions; caFile?: string} {
    const source = mapping(value, 'connection.secureOptions', ['servername', 'rejectUnauthorized', 'caFile', 'minVersion']);
    const options: ConnectionOptions = {};

    if (source.servername !== undefined) {
        options.servername = stringValue(source.servername, 'connection.secureOptions.servername');
    }

    if (source.rejectUnauthorized !== undefined) {
        options.rejectUnauthorized = booleanValue(source.rejectUnauthorized, 'connection.secureOptions.rejectUnauthorized');
    }

    if (source.minVersion !== undefined) {
        if (!['TLSv1.2', 'TLSv1.3'].includes(String(source.minVersion))) {
            throw new CliConfigError('connection.secureOptions.minVersion must be TLSv1.2 or TLSv1.3');
        }

        options.minVersion = source.minVersion as 'TLSv1.2' | 'TLSv1.3';
    }

    const caFile = source.caFile === undefined ? undefined :
        path.resolve(directory, stringValue(source.caFile, 'connection.secureOptions.caFile'));

    return {options, caFile};
}

function connectionConfig(value: unknown, directory: string): {
    connection: TransferConfig;
    trust?: CliTrustConfig;
    caFile?: string;
} {
    const preliminary = mapping(value, 'connection', [...ftpConnectionFields, ...sftpConnectionFields]);
    const protocol = preliminary.protocol;

    if (protocol !== 'ftp' && protocol !== 'ftps' && protocol !== 'ftps-implicit' && protocol !== 'sftp') {
        throw new CliConfigError('connection.protocol must be ftp, ftps, ftps-implicit or sftp');
    }

    const source = mapping(value, 'connection', protocol === 'sftp' ? sftpConnectionFields : ftpConnectionFields);
    const connection: TransferConfig = {
        ...operationOptions(source, 'connection'),
        protocol,
        host: stringValue(source.host, 'connection.host'),
        username: stringValue(source.username, 'connection.username', true),
    };

    for (const name of ['password', 'root', 'siteId'] as const) {
        if (source[name] !== undefined) {
            connection[name] = stringValue(source[name], `connection.${name}`, true);
        }
    }

    if (source.port !== undefined) {
        connection.port = integerValue(source.port, 'connection.port', 1, 65535);
    }

    if (source.timeout !== undefined) {
        connection.timeout = integerValue(source.timeout, 'connection.timeout', 0, 2147483647);
    }

    if (source.keepalive !== undefined) {
        const keepalive = mapping(source.keepalive, 'connection.keepalive', ['intervalMs', 'maxMissed']);

        connection.keepalive = {
            intervalMs: integerValue(keepalive.intervalMs, 'connection.keepalive.intervalMs', protocol === 'sftp' ? 0 : 1, 2147483647),
        };

        if (keepalive.maxMissed !== undefined) {
            connection.keepalive.maxMissed = integerValue(keepalive.maxMissed, 'connection.keepalive.maxMissed', 1);
        }
    }

    if (source.filenameEncoding !== undefined) {
        connection.filenameEncoding = filenameEncoding(source.filenameEncoding, protocol === 'sftp');
    }

    let trust: CliTrustConfig | undefined;
    let caFile: string | undefined;

    if (connection.protocol === 'sftp') {
        const sftp: SftpTransferConfig = connection;

        for (const name of [
            'privateKey',
            'privateKeyPath',
            'passphrase',
            'agent',
            'keyboardInteractive',
        ] as const) {
            if (source[name] !== undefined) {
                const string = stringValue(source[name], `connection.${name}`, name === 'passphrase');

                sftp[name] = name === 'privateKeyPath' ? path.resolve(directory, string) : string;
            }
        }

        if (source.agentForward !== undefined) {
            if (source.agentForward !== false) {
                throw new CliConfigError('connection.agentForward must be false');
            }

            sftp.agentForward = false;
        }

        if (source.readyTimeout !== undefined) {
            sftp.readyTimeout = integerValue(source.readyTimeout, 'connection.readyTimeout', 0, 2147483647);
        }

        trust = source.trust === undefined ? undefined : trustConfig(source.trust, directory);
    } else {
        const ftp: FtpTransferConfig = connection;

        if (source.passive !== undefined) {
            ftp.passive = booleanValue(source.passive, 'connection.passive');
        }

        if (source.secureOptions !== undefined) {
            const tls = tlsOptions(source.secureOptions, directory);

            ftp.secureOptions = tls.options;
            caFile = tls.caFile;
        }
    }

    try {
        validateTransferConfig(connection);
        resolveOperationOptions(connection);
    } catch {
        throw new CliConfigError('Connection configuration has invalid connection or transfer settings');
    }

    return {connection, trust, caFile};
}

/** Merge YAML defaults before command-line overrides and resolve only this command's local path. */
export function resolveCliCommandDefaults(config: LoadedCliConfig, command: CliCommand): CliCommandDefaults {
    const result = {...config.defaults, ...config.commands[command]};
    const directory = path.dirname(config.configFile);

    if (command === 'download' && result.destinationFile !== undefined) {
        result.destinationFile = path.resolve(directory, result.destinationFile);
    }

    if (command === 'upload' && result.sourceFile !== undefined) {
        result.sourceFile = path.resolve(directory, result.sourceFile);
    }

    return result;
}

export async function loadCliConfig(
    filename: string,
    options: {cwd?: string; env?: NodeJS.ProcessEnv} = {},
): Promise<LoadedCliConfig> {
    const configFile = path.resolve(options.cwd ?? process.cwd(), filename);
    const directory = path.dirname(configFile);
    const text = await readConfigText(configFile);
    const parsed = mapping(parseConfig(text, options.env ?? process.env), 'configuration', ['version', 'connection', 'defaults', 'commands']);

    if (parsed.version !== undefined && parsed.version !== 1 && parsed.version !== '1') {
        throw new CliConfigError('Configuration version must be 1');
    }

    const {connection, trust, caFile} = connectionConfig(parsed.connection, directory);
    const defaults = parsed.defaults === undefined ? {} : commandDefaults(parsed.defaults, 'defaults');
    const commandSource = parsed.commands === undefined ? {} : mapping(parsed.commands, 'commands', commandNames);
    const commands: LoadedCliConfig['commands'] = {};

    for (const command of commandNames) {
        if (commandSource[command] !== undefined) {
            commands[command] = commandDefaults(commandSource[command], `commands.${command}`, command);
        }
    }

    const loaded: LoadedCliConfig = {
        connection,
        trust,
        defaults,
        commands,
        configFile,
    };

    for (const command of ['download', 'upload'] as const) {
        const selected = commands[command];
        const field = command === 'download' ? 'destinationFile' : 'sourceFile';

        if (selected?.[field] !== undefined) {
            selected[field] = path.resolve(directory, selected[field]);
        }
    }

    if (caFile && connection.protocol !== 'sftp') {
        const certificate = await readConfigText(caFile);
        const certificates = certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);

        if (!certificates?.length) {
            throw new CliConfigError('connection.secureOptions.caFile must contain PEM certificates');
        }

        try {
            for (const pem of certificates) {
                new X509Certificate(pem);
            }
        } catch {
            throw new CliConfigError('connection.secureOptions.caFile must contain valid PEM certificates');
        }

        connection.secureOptions = {...connection.secureOptions, ca: certificate};
    }

    return loaded;
}
