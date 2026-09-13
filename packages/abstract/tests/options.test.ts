import {describe, expect, test} from 'vitest';
import {AuthError, ConnectorError, HostTrustError, isTransientError, NotFoundError, OperationAbortedError, OperationTimeoutError, PermissionError, resolveOperationOptions} from '../src/index.js';

describe('shared retry and timeout policy', () => {
    test('defaults to three additional attempts with reconnect opt-in', () => {
        expect(resolveOperationOptions()).toEqual({
            autoReconnect: false,
            maxTransientRetries: 3,
            timeoutMs: 30000,
            abortSignal: undefined,
        });
    });

    test('call overrides take precedence, including explicit zero and false', () => {
        const options = resolveOperationOptions(
            {maxTransientRetries: 8, autoReconnect: true, timeoutMs: 9000},
            {maxTransientRetries: 0, autoReconnect: false, timeout: 0},
        );

        expect(options).toMatchObject({maxTransientRetries: 0, autoReconnect: false, timeoutMs: 0});
    });

    test.each([
        -1,
        NaN,
        Infinity,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
    ])('rejects an invalid retry budget %s', (value) => {
        expect(() => resolveOperationOptions({maxTransientRetries: value})).toThrow(RangeError);
    });

    test.each([
        -1,
        NaN,
        Infinity,
        1.5,
        2147483648,
    ])('rejects a deadline that timers cannot enforce %s', (value) => {
        expect(() => resolveOperationOptions({timeoutMs: value})).toThrow(RangeError);
    });

    test('recognizes transient transport errors and preserves runtime error identity', () => {
        for (const code of [
            'ETIMEDOUT',
            'ECONNRESET',
            'EPIPE',
            'EAI_AGAIN',
            421,
            425,
            426,
        ]) {
            expect(isTransientError(new ConnectorError('Temporary transport failure', undefined, code))).toBe(true);
        }

        expect(isTransientError(new OperationTimeoutError())).toBe(true);
        expect(new OperationTimeoutError()).toBeInstanceOf(ConnectorError);
    });

    test('never retries permanent errors even if their messages contain timeout', () => {
        for (const ErrorType of [
            AuthError,
            PermissionError,
            NotFoundError,
            HostTrustError,
            OperationAbortedError,
        ]) {
            expect(isTransientError(new ErrorType('timeout'))).toBe(false);
        }

        expect(isTransientError(new ConnectorError('timeout', undefined, 'EACCES'))).toBe(false);
        expect(isTransientError(new ConnectorError('Unknown server failure', undefined, 4))).toBe(false);
    });
});
