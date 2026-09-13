import type {StatEntry} from '@flystorage/file-storage';
import {describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {
    checksumDetails, copyFileWithStrategy, createTransferMonitor, isTransientError, publishFile,
    resolveOperationOptions, IntegrityError, PublicationError, ResourceLimitError,
    type TransferConnector, type TransferProgressEvent,
} from '../src/index.js';
import {resolveByteLimit} from '../src/byte-limit.js';

function remote(bytes = Buffer.from('hello'), advertisedSize = bytes.length) {
    const connector = {
        read: vi.fn(async () => Readable.from([bytes])),
        stat: vi.fn(async (): Promise<StatEntry> => ({
            type: 'file',
            path: 'source',
            isFile: true,
            isDirectory: false,
            size: advertisedSize,
        })),
        validatePublicationOptions: vi.fn(),
        createDirectoryExclusive: vi.fn(async () => {}),
        removeEmptyDirectory: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
        renameFile: vi.fn(async () => ({atomic: false})),
        deleteFile: vi.fn(async () => {}),
        deleteDirectory: vi.fn(async () => {}),
        async *list() {},
    };

    return connector satisfies TransferConnector;
}

describe('opt-in transfer byte limits', () => {
    it.each([
        undefined,
        Infinity,
        0,
        10,
        Number.MAX_SAFE_INTEGER,
    ])('accepts the explicit byte policy %s', value => {
        expect(resolveByteLimit(value)).toBe(value === undefined ? Infinity : value);
        expect(() => resolveOperationOptions({maxBytes: value})).not.toThrow();
    });

    it.each([
        -1,
        -Infinity,
        NaN,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        null,
        '10',
    ])('rejects invalid byte policy %s', value => {
        const maxBytes = value as number;

        expect(() => resolveByteLimit(maxBytes)).toThrow(RangeError);
        expect(() => resolveOperationOptions({maxBytes})).toThrow(RangeError);
        expect(() => resolveOperationOptions({maxBytes: 10}, {maxBytes})).toThrow(RangeError);
        expect(() => createTransferMonitor({maxBytes}, 'download', 1)).toThrow(RangeError);
    });

    it('streams beyond 1 GiB by default using one reusable buffer without buffering the transfer', async () => {
        const chunk = Buffer.alloc(1024 * 1024);
        const monitor = createTransferMonitor({}, 'download', 1);
        let received = 0;

        function* source() {
            for (let index = 0; index < 1025; index++) {
                yield chunk;
            }
        }

        await pipeline(Readable.from(source()), monitor.stream, new Writable({
            write(bytes: Buffer, _encoding, callback) {
                expect(bytes).toBe(chunk);
                received += bytes.length;
                callback();
            },
        }));
        monitor.complete();
        expect(received).toBe(1074790400);
    });

    it('rejects an over-budget chunk before forwarding it or counting it as progress', async () => {
        const events: TransferProgressEvent[] = [];
        const chunks: Buffer[] = [];
        const monitor = createTransferMonitor({
            maxBytes: 3,
            progressIntervalMs: 0,
            onProgress: event => events.push(event),
        }, 'download', 1);
        const transfer = pipeline(Readable.from(['ok', 'too large']), monitor.stream, new Writable({
            write(bytes: Buffer, _encoding, callback) {
                chunks.push(bytes);
                callback();
            },
        }));

        await expect(transfer).rejects.toBeInstanceOf(ResourceLimitError);
        expect(Buffer.concat(chunks).toString()).toBe('ok');
        expect(events.at(-1)).toMatchObject({stage: 'failed', bytesTransferred: 2});
        expect(events.every(event => event.bytesTransferred <= 3)).toBe(true);
        expect(isTransientError(new ResourceLimitError('timeout while checking maxBytes'))).toBe(false);
    });

    it('allows empty transfers with a zero-byte limit', async () => {
        const monitor = createTransferMonitor({maxBytes: 0}, 'upload', 1);

        await pipeline(Readable.from([]), monitor.stream, new Writable({
            write(_bytes, _encoding, callback) {
                callback();
            },
        }));
        monitor.complete();
    });

    it.each([undefined, Infinity])('does not reject large advertised checksum/copy sources with %s', async maxBytes => {
        const checksumSource = remote(Buffer.from('small incomplete read'), 1073741825);
        const copySource = remote(Buffer.from('small incomplete read'), 1073741825);

        await expect(checksumDetails(checksumSource, 'source', {strategy: 'stream', maxBytes}))
            .rejects.toBeInstanceOf(IntegrityError);
        await expect(copyFileWithStrategy(copySource, 'source', 'destination', {maxBytes}))
            .rejects.toBeInstanceOf(IntegrityError);
        expect(checksumSource.read).toHaveBeenCalledOnce();
        expect(copySource.read).toHaveBeenCalledOnce();
        expect(copySource.write).not.toHaveBeenCalled();
    });

    it('retains explicit checksum/copy budgets before opening oversized sources', async () => {
        const connector = remote();

        await expect(checksumDetails(connector, 'source', {strategy: 'stream', maxBytes: 4}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        await expect(copyFileWithStrategy(connector, 'source', 'destination', {maxBytes: 4}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(connector.read).not.toHaveBeenCalled();
    });

    it.each([-1, NaN, null])('validates nested verification budget %s before publication mutates anything', async value => {
        const connector = remote();
        const options = {verify: {expectedDigest: '0'.repeat(64), maxBytes: value as number}};

        await expect(publishFile(connector, 'destination', Readable.from(['hello']), options))
            .rejects.toBeInstanceOf(RangeError);
        await expect(copyFileWithStrategy(connector, 'source', 'destination', options))
            .rejects.toBeInstanceOf(RangeError);
        expect(connector.createDirectoryExclusive).not.toHaveBeenCalled();
        expect(connector.stat).not.toHaveBeenCalled();
        expect(connector.write).not.toHaveBeenCalled();
    });

    it('inherits a verification budget through undefined and lets Infinity explicitly override it', async () => {
        const connector = remote();
        const expectedDigest = createHash('sha256').update('hello').digest('hex');

        await expect(publishFile(connector, 'destination', Readable.from(['hello']), {
            maxBytes: 4,
            verify: {expectedDigest, maxBytes: undefined},
        })).rejects.toBeInstanceOf(PublicationError);
        expect(connector.read).not.toHaveBeenCalled();
        await expect(publishFile(connector, 'destination', Readable.from(['hello']), {
            maxBytes: 4,
            verify: {expectedDigest, maxBytes: Infinity},
        })).resolves.toMatchObject({verified: true});
        expect(connector.read).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({maxBytes: Infinity}));
    });
});
