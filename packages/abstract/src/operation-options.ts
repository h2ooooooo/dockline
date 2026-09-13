import {AuthError, HostTrustError, NotFoundError, NotSupportedError, OperationAbortedError, PermissionError, ResourceLimitError, UnsupportedProtocolError} from './errors.js';
import {resolveByteLimit} from './byte-limit.js';
import type {Readable} from 'node:stream';
import type {BandwidthBudget, TransferProgressEvent} from './transfer-monitor.js';

export type TransferSourceFactory = () => Readable | Promise<Readable>;
export type TransferContents = Readable | TransferSourceFactory;

export interface ConnectorOperationOptions {
    autoReconnect?: boolean;
    /** Additional attempts after the first attempt, for safe transient failures. */
    maxTransientRetries?: number;
    /** Per-attempt deadline in milliseconds. Zero disables this deadline. */
    timeoutMs?: number;
    /** Flystorage-compatible alias for timeoutMs. */
    timeout?: number;
    abortSignal?: AbortSignal;
    /** Optional observers never change the outcome of a transfer. */
    onProgress?: (event: TransferProgressEvent) => void;
    totalBytes?: number;
    /** Optional per-transfer byte limit. Undefined inherits; Infinity explicitly removes a configured limit. */
    maxBytes?: number;
    progressIntervalMs?: number;
    /** Bytes per second for this transfer, or an explicit shared budget. */
    bandwidth?: number | BandwidthBudget;
}

export interface ResolvedConnectorOperationOptions {
    autoReconnect: boolean;
    maxTransientRetries: number;
    timeoutMs: number;
    abortSignal?: AbortSignal;
}

export function resolveOperationOptions(
    defaults: ConnectorOperationOptions = {},
    overrides: ConnectorOperationOptions = {},
): ResolvedConnectorOperationOptions {
    resolveByteLimit(defaults.maxBytes);
    resolveByteLimit(overrides.maxBytes);

    const autoReconnect = overrides.autoReconnect ?? defaults.autoReconnect ?? false;
    const maxTransientRetries = overrides.maxTransientRetries ?? defaults.maxTransientRetries ?? 3;
    const timeoutMs = overrides.timeoutMs ?? overrides.timeout ?? defaults.timeoutMs ?? defaults.timeout ?? 30000;
    const abortSignal = overrides.abortSignal ?? defaults.abortSignal;

    if (typeof autoReconnect !== 'boolean') {
        throw new TypeError('autoReconnect must be a boolean');
    }

    if (!Number.isSafeInteger(maxTransientRetries) || maxTransientRetries < 0) {
        throw new RangeError('maxTransientRetries must be a non-negative safe integer');
    }

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647) {
        throw new RangeError('timeoutMs must be an integer from 0 to 2147483647');
    }

    if (
        abortSignal !== undefined &&
        (typeof abortSignal.aborted !== 'boolean' ||
            typeof abortSignal.addEventListener !== 'function')
    ) {
        throw new TypeError('abortSignal must be an AbortSignal');
    }

    return {
        autoReconnect,
        maxTransientRetries,
        timeoutMs,
        abortSignal,
    };
}

export function isTransientError(error: unknown): boolean {
    if (
        error instanceof AuthError ||
        error instanceof PermissionError ||
        error instanceof NotFoundError ||
        error instanceof NotSupportedError ||
        error instanceof UnsupportedProtocolError ||
        error instanceof OperationAbortedError ||
        error instanceof HostTrustError ||
        error instanceof ResourceLimitError
    ) {
        return false;
    }

    if (!(error instanceof Error)) {
        return false;
    }

    const code = (error as Error & {code?: string | number}).code;
    const nonRetryableCodes = [
        'ABORT_ERR',
        'HOST_TRUST_REJECTED',
        'EACCES',
        'EPERM',
        'ENOENT',
    ];

    if (code !== undefined && nonRetryableCodes.includes(String(code))) {
        return false;
    }

    const transientCodes: Array<string | number> = [
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'ECONNRESET',
        'ECONNABORTED',
        'EPIPE',
        'EAI_AGAIN',
        421,
        425,
        426,
    ];

    if (code !== undefined && transientCodes.includes(code)) {
        return true;
    }

    if (code !== undefined) {
        return false;
    }

    return /(?:timed? out|timeout|socket hang up|connection reset)/i.test(error.message);
}
