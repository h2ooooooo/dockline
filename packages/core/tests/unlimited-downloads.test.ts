import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Readable, Writable} from 'node:stream';
import {Dockline} from '../src/Dockline.js';
import {ResourceLimitError} from '@jalsoedesign/dockline-abstract';

const sink = vi.hoisted(() => ({bytes: 0}));

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();

    return {
        ...actual,
        // Count the real streamed bytes while keeping only an empty staging file on disk.
        createWriteStream: (filename: string, options: {flags: string; mode: number}) => new Writable({
            construct(callback) {
                writeFile(filename, '', {flag: options.flags, mode: options.mode}).then(() => callback(), callback);
            },
            write(chunk, encoding, callback) {
                sink.bytes += Buffer.byteLength(chunk, encoding);
                callback();
            },
        }),
    };
});

const chunk = Buffer.alloc(1024 * 1024);
const chunkCount = 1025;
const expectedBytes = chunk.length * chunkCount;
let directory: string;

function largeStream(): Readable {
    return Readable.from((function* () {
        for (let index = 0; index < chunkCount; index++) {
            yield chunk;
        }
    })());
}

beforeEach(async () => {
    sink.bytes = 0;
    directory = await mkdtemp(join(tmpdir(), 'dockline-sdk-unlimited-'));
});

afterEach(async () => {
    vi.restoreAllMocks();

    const target = resolve(directory);
    const temporaryRoot = `${resolve(tmpdir())}${sep}`;

    if (!target.startsWith(temporaryRoot) || !target.includes('dockline-sdk-unlimited-')) {
        throw new Error('Unexpected unlimited download test directory');
    }

    await rm(target, {recursive: true, force: true});
});

describe('SDK downloads above the former implicit limit', () => {
    it.each([expectedBytes, undefined])('streams more than 1 GiB with metadata size %s and no maxBytes', async size => {
        const remote = new Dockline({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'});

        vi.spyOn(remote.connector, 'stat').mockResolvedValue({type: 'file', size} as any);

        const read = vi.spyOn(remote, 'read').mockImplementation(async () => largeStream());

        await remote.downloadFile('large.bin', join(directory, 'large.bin'));
        expect(read).toHaveBeenCalledWith('large.bin', {maxBytes: Infinity});
        expect(sink.bytes).toBe(expectedBytes);
        expect(await readdir(directory)).toEqual(['large.bin']);
    });

    it('still stops the same stream when the caller explicitly selects 1 GiB', async () => {
        const remote = new Dockline({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'});

        vi.spyOn(remote.connector, 'stat').mockResolvedValue({type: 'file'} as any);
        vi.spyOn(remote, 'read').mockImplementation(async () => largeStream());

        await expect(remote.downloadFile('large.bin', join(directory, 'large.bin'), {maxBytes: 1024 ** 3}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(sink.bytes).toBe(1024 ** 3);
        expect(await readdir(directory)).toEqual([]);
    });
});
