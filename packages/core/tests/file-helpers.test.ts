import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Readable} from 'node:stream';
import {Dockline, type SftpTransferConfig} from '../src/Dockline.js';
import {
    IntegrityError, NotSupportedError, OperationAbortedError, ResourceLimitError,
    type TransferSourceFactory, type TransferContents, type ConnectorOperationOptions,
} from '@dockline/abstract';

const connection: SftpTransferConfig = {
    protocol: 'sftp',
    host: 'fixture.invalid',
    username: 'fixture',
    root: '/',
};
let directory: string;

async function consume(stream: Readable): Promise<Buffer> {
    const bytes: Buffer[] = [];

    for await (const part of stream) {
        bytes.push(Buffer.from(part));
    }

    return Buffer.concat(bytes);
}

function download(
    contents = Buffer.from('downloaded bytes'),
    expectedSize: number | undefined = contents.length,
    config: SftpTransferConfig = connection,
) {
    const remote = new Dockline(config);
    const metadata = vi.spyOn(remote.connector, 'stat').mockResolvedValue({type: 'file', size: expectedSize} as any);
    const read = vi.spyOn(remote, 'read').mockImplementation(async () => Readable.from([contents]));

    return {
        remote,
        metadata,
        read,
        contents,
    };
}

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dockline-sdk-files-'));
});

afterEach(async () => {
    vi.restoreAllMocks();

    const target = resolve(directory);
    const temporaryRoot = `${resolve(tmpdir())}${sep}`;

    if (!target.startsWith(temporaryRoot) || !target.includes('dockline-sdk-files-')) {
        throw new Error('Unexpected SDK test directory');
    }

    await rm(target, {recursive: true, force: true});
});

describe('SDK upload ownership', () => {
    it('supplies a fresh file stream for each eligible retry and reports known local bytes', async () => {
        const filename = join(directory, 'source.bin');
        const bytes = Buffer.from([0, 255, 128, 42]);
        const remote = new Dockline(connection);
        const seen: Readable[] = [];

        await writeFile(filename, bytes);

        const write = vi.spyOn(remote.connector, 'write').mockImplementation(async (destination: string, contents: TransferContents, options: ConnectorOperationOptions) => {
            expect(destination).toBe('release.bin');
            expect(options).toMatchObject({totalBytes: bytes.length, maxTransientRetries: 2});
            expect(typeof contents).toBe('function');

            for (let attempt = 0; attempt < 2; attempt++) {
                const stream = await (contents as TransferSourceFactory)();

                seen.push(stream);
                expect(await consume(stream)).toEqual(bytes);
            }
        });

        await remote.uploadFile(filename, './release.bin', {maxTransientRetries: 2});
        expect(write).toHaveBeenCalledOnce();
        expect(seen[0]).not.toBe(seen[1]);
    });

    it('selects no-replace publication explicitly instead of an overwriting write', async () => {
        const filename = join(directory, 'source.txt');
        const remote = new Dockline(connection);

        await writeFile(filename, 'contents');

        const validate = vi.spyOn(remote.connector, 'validatePublicationOptions');
        const publish = vi.spyOn(remote.connector, 'publishFile').mockResolvedValue({
            destination: 'release.txt',
            atomic: false,
            verified: false,
            cleanup: 'done',
        });
        const write = vi.spyOn(remote.connector, 'write');

        await remote.uploadFile(filename, 'release.txt', {overwrite: 'fail'});
        expect(validate).toHaveBeenCalledWith({overwrite: 'fail'});
        expect(publish).toHaveBeenCalledWith('release.txt', expect.any(Function), {overwrite: 'fail', totalBytes: 8});
        expect(write).not.toHaveBeenCalled();
    });

    it('rejects unsupported FTP no-replace before reading a local source or starting a transfer', async () => {
        const remote = new Dockline({protocol: 'ftp', host: 'fixture.invalid', username: 'fixture'});
        const write = vi.spyOn(remote.connector, 'write');
        const publish = vi.spyOn(remote.connector, 'publishFile');

        await expect(remote.uploadFile(join(directory, 'does-not-exist'), 'remote.txt', {overwrite: 'fail'}))
            .rejects.toBeInstanceOf(NotSupportedError);
        expect(write).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('rejects local directories and pre-cancelled uploads before transport work', async () => {
        const remote = new Dockline(connection);
        const write = vi.spyOn(remote.connector, 'write');
        const controller = new AbortController();

        controller.abort();
        await expect(remote.uploadFile(directory, 'remote')).rejects.toBeInstanceOf(NotSupportedError);
        await expect(remote.uploadFile('missing-local-file', 'remote', {abortSignal: controller.signal}))
            .rejects.toBeInstanceOf(OperationAbortedError);
        expect(write).not.toHaveBeenCalled();
    });

    it('keeps literal text distinct from a local filename and makes its bytes replayable', async () => {
        const remote = new Dockline(connection);
        const payload = join(directory, 'this-is-text.txt');

        vi.spyOn(remote.connector, 'write').mockImplementation(async (_destination: string, contents: TransferContents) => {
            expect(typeof contents).toBe('function');

            const first = await (contents as TransferSourceFactory)();
            const second = await (contents as TransferSourceFactory)();

            expect(first).not.toBe(second);
            expect((await consume(first)).toString()).toBe(payload);
            expect((await consume(second)).toString()).toBe(payload);
        });
        await remote.write('literal.txt', payload);
    });
});

describe('SDK completed local downloads', () => {
    it('publishes complete bytes and removes its staging directory', async () => {
        const {remote, contents} = download();
        const destination = join(directory, 'download.bin');

        await remote.downloadFile('download.bin', destination);
        expect(await readFile(destination)).toEqual(contents);
        expect(await readdir(directory)).toEqual(['download.bin']);
    });

    it('preserves an existing destination by default and cleans the rejected staging output', async () => {
        const {remote} = download();
        const destination = join(directory, 'existing.bin');

        await writeFile(destination, 'existing data');
        await expect(remote.downloadFile('download.bin', destination)).rejects.toMatchObject({code: 'EEXIST'});
        expect(await readFile(destination, 'utf8')).toBe('existing data');
        expect(await readdir(directory)).toEqual(['existing.bin']);
    });

    it('replaces the destination only after a successful complete download', async () => {
        const {remote, contents} = download();
        const destination = join(directory, 'existing.bin');

        await writeFile(destination, 'existing data');
        await remote.downloadFile('download.bin', destination, {overwrite: 'replace'});
        expect(await readFile(destination)).toEqual(contents);
        expect(await readdir(directory)).toEqual(['existing.bin']);
    });

    it('rejects a truncated stream without publishing partial content', async () => {
        const {remote} = download(Buffer.from('short'), 20);
        const destination = join(directory, 'download.bin');

        await expect(remote.downloadFile('download.bin', destination)).rejects.toBeInstanceOf(IntegrityError);
        await expect(stat(destination)).rejects.toMatchObject({code: 'ENOENT'});
        expect(await readdir(directory)).toEqual([]);
    });

    it('retains the existing destination after a remote stream fails mid-download', async () => {
        const {remote, read} = download();
        const destination = join(directory, 'existing.bin');
        const failure = new Error('Remote body failed');

        await writeFile(destination, 'original');
        read.mockImplementation(async () => Readable.from((async function* () {
            yield Buffer.from('partial');

            throw failure;
        })()));
        await expect(remote.downloadFile('download.bin', destination, {overwrite: 'replace'})).rejects.toBe(failure);
        expect(await readFile(destination, 'utf8')).toBe('original');
        expect(await readdir(directory)).toEqual(['existing.bin']);
    });

    it('rejects the known byte budget before reading or creating staging files', async () => {
        const {remote, read} = download(Buffer.alloc(20));

        await expect(remote.downloadFile('large.bin', join(directory, 'download.bin'), {maxBytes: 10}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(read).not.toHaveBeenCalled();
        expect(await readdir(directory)).toEqual([]);
    });

    it('enforces the byte budget even when initial metadata has no size', async () => {
        const {remote, metadata} = download(Buffer.alloc(20));

        metadata.mockResolvedValue({type: 'file'} as any);
        await expect(remote.downloadFile('large.bin', join(directory, 'download.bin'), {maxBytes: 10}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(await readdir(directory)).toEqual([]);
    });

    it('inherits a configured limit, including when the call supplies undefined', async () => {
        const {remote, read} = download(Buffer.alloc(20), 20, {...connection, maxBytes: 10});

        for (const options of [{}, {maxBytes: undefined}]) {
            await expect(remote.downloadFile('large.bin', join(directory, 'download.bin'), options))
                .rejects.toBeInstanceOf(ResourceLimitError);
        }

        expect(read).not.toHaveBeenCalled();
        expect(await readdir(directory)).toEqual([]);
    });

    it.each([20, Infinity])('overrides a configured limit with %s on an individual download', async maxBytes => {
        const {remote, contents, read} = download(Buffer.alloc(20), 20, {...connection, maxBytes: 10});
        const destination = join(directory, 'download.bin');

        await remote.downloadFile('download.bin', destination, {maxBytes});
        expect(read).toHaveBeenCalledWith('download.bin', {maxBytes});
        expect(await readFile(destination)).toEqual(contents);
    });

    it('retains a configured limit after a single unlimited download', async () => {
        const {remote, read} = download(Buffer.alloc(20), 20, {...connection, maxBytes: 10});

        await remote.downloadFile('large.bin', join(directory, 'unlimited.bin'), {maxBytes: Infinity});
        await expect(remote.downloadFile('large.bin', join(directory, 'limited.bin')))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(read).toHaveBeenCalledOnce();
        expect(await readdir(directory)).toEqual(['unlimited.bin']);
    });

    it('allows an empty download with a zero-byte limit and rejects nonempty content', async () => {
        const empty = download(Buffer.alloc(0));

        await empty.remote.downloadFile('empty.bin', join(directory, 'empty.bin'), {maxBytes: 0});
        expect((await stat(join(directory, 'empty.bin'))).size).toBe(0);

        const nonempty = download(Buffer.from('x'));

        nonempty.metadata.mockResolvedValue({type: 'file'} as any);
        await expect(nonempty.remote.downloadFile('nonempty.bin', join(directory, 'nonempty.bin'), {maxBytes: 0}))
            .rejects.toBeInstanceOf(ResourceLimitError);
        expect(await readdir(directory)).toEqual(['empty.bin']);
    });

    it.each([
        -1,
        NaN,
        -Infinity,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        null,
    ])(
        'rejects invalid maxBytes %s before metadata or staging work',
        async maxBytes => {
            const {remote, metadata, read} = download();

            await expect(remote.downloadFile('file', join(directory, 'file'), {maxBytes: maxBytes as number}))
                .rejects.toThrow(RangeError);
            expect(metadata).not.toHaveBeenCalled();
            expect(read).not.toHaveBeenCalled();
            expect(await readdir(directory)).toEqual([]);
        },
    );

    it('rejects a remote directory and invalid limits before streaming', async () => {
        const {remote, metadata, read} = download();

        metadata.mockResolvedValue({type: 'directory'} as any);
        await expect(remote.downloadFile('directory', join(directory, 'file'))).rejects.toBeInstanceOf(NotSupportedError);
        await expect(remote.downloadFile('file', join(directory, 'file'), {maxBytes: -1})).rejects.toThrow(RangeError);
        expect(read).not.toHaveBeenCalled();
        expect(await readdir(directory)).toEqual([]);
    });

    it('honors a global cancellation signal before metadata and allows an explicit per-call signal', async () => {
        const controller = new AbortController();

        controller.abort();

        const remote = new Dockline({...connection, abortSignal: controller.signal});
        const metadata = vi.spyOn(remote.connector, 'stat').mockResolvedValue({type: 'file', size: 4} as any);

        vi.spyOn(remote, 'read').mockResolvedValue(Readable.from(['data']));
        await expect(remote.downloadFile('file', join(directory, 'file'))).rejects.toBeInstanceOf(OperationAbortedError);
        expect(metadata).not.toHaveBeenCalled();

        const active = new AbortController();

        await remote.downloadFile('file', join(directory, 'file'), {abortSignal: active.signal});
        expect(await readFile(join(directory, 'file'), 'utf8')).toBe('data');
    });

    it('maps in-flight cancellation to the shared error and removes partial staging bytes', async () => {
        const {remote, read, metadata} = download();
        const controller = new AbortController();
        const source = new Readable({read() {}});

        metadata.mockResolvedValue({type: 'file'} as any);
        read.mockResolvedValue(source);

        const pending = remote.downloadFile('file', join(directory, 'file'), {abortSignal: controller.signal});
        const rejected = expect(pending).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
        source.push(Buffer.from('partial'));
        controller.abort();
        await rejected;
        expect(source.destroyed).toBe(true);
        expect(await readdir(directory)).toEqual([]);
    });

    it('preserves unexpected staging contents and both errors when failure cleanup cannot finish', async () => {
        const {remote, read, metadata} = download();
        const failure = new Error('Remote read failed');

        metadata.mockResolvedValue({type: 'file'} as any);
        read.mockImplementation(async () => {
            const staging = (await readdir(directory)).find(name => name.startsWith('.dockline-'))!;

            await writeFile(join(directory, staging, 'unrelated'), 'keep me');

            throw failure;
        });

        const caught = await remote.downloadFile('file', join(directory, 'file')).catch(error => error);

        expect(caught).toBeInstanceOf(AggregateError);
        expect(caught.errors[0]).toBe(failure);

        const staging = (await readdir(directory)).find(name => name.startsWith('.dockline-'))!;

        expect(await readdir(join(directory, staging))).toEqual(['unrelated']);
        expect(await readFile(join(directory, staging, 'unrelated'), 'utf8')).toBe('keep me');
    });
});
