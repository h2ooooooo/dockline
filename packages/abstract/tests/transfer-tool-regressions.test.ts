import {describe, expect, it, vi} from 'vitest';
import {Readable} from 'node:stream';
import {posix} from 'node:path';
import type {StatEntry} from '@flystorage/file-storage';
import {
    ConnectorError, NotFoundError, NotSupportedError, PermissionError, OperationAbortedError,
    copyFileWithStrategy, describeCapabilities, publishFile, walk,
    type PublishFileOptions, type TransferContents,
} from '../src/index.js';

class ControlledRemote {
    public readonly calls: string[] = [];

    public readonly directories = new Set(['.']);

    public readonly files = new Map([['source', Buffer.from('source contents')]]);

    public rejectPolicy = false;

    public failBeforeWrite = false;

    public addUnrelatedFile = false;

    public denyCleanup = false;

    public validatePublicationOptions(_options: PublishFileOptions): void {
        this.calls.push('preflight');

        if (this.rejectPolicy) {
            throw new NotSupportedError('This fixture cannot guarantee the requested publication policy');
        }
    }

    public async createDirectoryExclusive(path: string): Promise<void> {
        this.calls.push(`mkdir:${path}`);

        if (this.directories.has(path)) {
            throw new ConnectorError('Already exists');
        }

        this.directories.add(path);
    }

    public async removeEmptyDirectory(path: string): Promise<void> {
        this.calls.push(`rmdir:${path}`);

        if ([...this.files.keys()].some(file => posix.dirname(file) === path)) {
            throw new ConnectorError('Directory is not empty');
        }

        this.directories.delete(path);
    }

    public async deleteDirectory(): Promise<void> {
        throw new Error('Recursive cleanup must never be used');
    }

    public async deleteFile(path: string): Promise<void> {
        this.calls.push(`delete:${path}`);

        if (this.denyCleanup) {
            throw new PermissionError('Cannot remove staged file');
        }

        if (!this.files.delete(path)) {
            throw new NotFoundError('Staged file was never created');
        }
    }

    public async write(path: string, contents: TransferContents): Promise<void> {
        this.calls.push(`write:${path}`);

        if (this.addUnrelatedFile) {
            this.files.set(posix.join(posix.dirname(path), 'unrelated'), Buffer.from('retain'));
        }

        if (this.failBeforeWrite) {
            throw new ConnectorError('Source could not be opened');
        }

        const source = typeof contents === 'function' ? await contents() : contents;
        const chunks: Buffer[] = [];

        for await (const chunk of source) {
            chunks.push(Buffer.from(chunk));
        }

        this.files.set(path, Buffer.concat(chunks));
    }

    public async read(path: string): Promise<Readable> {
        this.calls.push(`read:${path}`);

        return Readable.from([this.files.get(path)!]);
    }

    public async stat(path: string): Promise<StatEntry> {
        this.calls.push(`stat:${path}`);

        const contents = this.files.get(path);

        if (!contents) {
            throw new NotFoundError('Missing fixture file');
        }

        return {
            type: 'file',
            path,
            isFile: true,
            isDirectory: false,
            size: contents.length,
        };
    }

    public async *list(path: string): AsyncGenerator<StatEntry> {
        for (const file of this.files.keys()) {
            if (posix.dirname(file) === path) {
                yield await this.stat(file);
            }
        }
    }

    public async renameFile(from: string, to: string): Promise<{atomic: boolean}> {
        this.calls.push(`rename:${from}:${to}`);
        this.files.set(to, this.files.get(from)!);
        this.files.delete(from);

        return {atomic: false};
    }
}

describe('publication policy and owned cleanup regressions', () => {
    it('rejects unsupported generic publication before owning or writing any remote path', async () => {
        const remote = new ControlledRemote();

        remote.rejectPolicy = true;
        await expect(publishFile(remote, 'destination', Readable.from(['data']), {
            requireAtomicRename: true,
        })).rejects.toBeInstanceOf(NotSupportedError);
        expect(remote.calls).toEqual(['preflight']);
        expect(remote.directories).toEqual(new Set(['.']));
    });

    it('checks copy policy before metadata, reading, local staging or remote staging', async () => {
        const remote = new ControlledRemote();

        remote.rejectPolicy = true;
        await expect(copyFileWithStrategy(remote, 'source', 'destination', {
            requireAtomicRename: true,
        })).rejects.toBeInstanceOf(NotSupportedError);
        expect(remote.calls).toEqual(['preflight']);
        expect([...remote.files.keys()]).toEqual(['source']);
    });

    it('removes an owned empty directory when the upload never created its contents', async () => {
        const remote = new ControlledRemote();

        remote.failBeforeWrite = true;
        await expect(publishFile(remote, 'destination', Readable.from(['data'])))
            .rejects.toMatchObject({state: {phase: 'upload', outcome: 'not-published', cleanup: 'done'}});
        expect(remote.directories).toEqual(new Set(['.']));
        expect(remote.calls.some(call => call.startsWith('rmdir:'))).toBe(true);
    });

    it('retains unrelated remote contents instead of recursively cleaning their directory', async () => {
        const remote = new ControlledRemote();

        remote.failBeforeWrite = true;
        remote.addUnrelatedFile = true;
        await expect(publishFile(remote, 'destination', Readable.from(['data'])))
            .rejects.toMatchObject({state: {outcome: 'not-published', cleanup: 'failed'}});
        expect([...remote.files.entries()].filter(([path]) => path.endsWith('/unrelated')))
            .toEqual([[expect.any(String), Buffer.from('retain')]]);
        expect(remote.calls.some(call => call.startsWith('delete:') && call.endsWith('/unrelated'))).toBe(false);
    });

    it('does not ignore a cleanup permission error or try a directory removal after it', async () => {
        const remote = new ControlledRemote();

        remote.failBeforeWrite = true;
        remote.denyCleanup = true;
        await expect(publishFile(remote, 'destination', Readable.from(['data'])))
            .rejects.toMatchObject({state: {cleanup: 'failed'}});
        expect(remote.calls.some(call => call.startsWith('rmdir:'))).toBe(false);
    });
});

describe('walk cancellation and lifecycle regressions', () => {
    it('cancels a filter that never resolves and closes the active directory iterator', async () => {
        const controller = new AbortController();
        let entered = false;
        let closed = false;
        const remote = new ControlledRemote();
        const list = remote.list.bind(remote);

        remote.list = async function* (path) {
            try {
                yield* list(path);
            } finally {
                closed = true;
            }
        };

        const traversal = walk(remote, '.', {
            abortSignal: controller.signal,
            filter: () => {
                entered = true;

                return new Promise<boolean>(() => {});
            },
        });
        const next = traversal.entries.next();
        const rejection = expect(next).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(entered).toBe(true));
        controller.abort();
        await rejection;
        expect(await traversal.result).toMatchObject({complete: false, reason: 'cancelled'});
        expect(closed).toBe(true);
    });

    it('never yields an entry approved after cancellation and handles late callback rejection', async () => {
        const controller = new AbortController();
        let rejectFilter!: (error: Error) => void;
        const traversal = walk(new ControlledRemote(), '.', {
            abortSignal: controller.signal,
            filter: () => new Promise<boolean>((_resolve, reject) => {
                rejectFilter = reject;
            }),
        });
        const next = traversal.entries.next();
        const rejection = expect(next).rejects.toBeInstanceOf(OperationAbortedError);

        await vi.waitFor(() => expect(rejectFilter).toBeDefined());
        controller.abort();
        await rejection;
        rejectFilter(new Error('Late UI rejection'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(await traversal.result).toMatchObject({complete: false, reason: 'cancelled'});
    });

    it('checks cancellation after a filter resolves synchronously', async () => {
        const controller = new AbortController();
        const traversal = walk(new ControlledRemote(), '.', {
            abortSignal: controller.signal,
            filter: () => {
                controller.abort();

                return true;
            },
        });

        await expect(traversal.entries.next()).rejects.toBeInstanceOf(OperationAbortedError);
        expect(await traversal.result).toMatchObject({complete: false, reason: 'cancelled'});
    });

    it('settles a thrown failure or cancellation before the first entry is requested', async () => {
        const failure = walk(new ControlledRemote(), '.');

        await expect(failure.entries.throw(new Error('consumer failed'))).rejects.toThrow('consumer failed');
        expect(await failure.result).toEqual({complete: false, reason: 'failed', entries: 0});

        const cancellation = walk(new ControlledRemote(), '.');

        await expect(cancellation.entries.throw(new OperationAbortedError()))
            .rejects.toBeInstanceOf(OperationAbortedError);
        expect(await cancellation.result).toEqual({complete: false, reason: 'cancelled', entries: 0});
    });
});

describe('capability inventory truthfulness', () => {
    it('keeps server support unknown when an adapter cannot observe or implement it', () => {
        const sftp = describeCapabilities('sftp');
        const ftp = describeCapabilities('ftp', []);

        expect(sftp.adapter.serverChecksum.state).toBe('unsupported');
        expect(sftp.server.checksum.state).toBe('unknown');
        expect(sftp.inventory).toBe('not-requested');
        expect(ftp.adapter.atomicReplace.state).toBe('unsupported');
        expect(ftp.server.atomicReplace.state).toBe('unknown');
        expect(ftp.inventory).toBe('unavailable');
        expect(ftp.negotiated).toBe(true);
    });

    it('distinguishes available advertisements from unavailable inventory without claiming permissions', () => {
        const advertised = describeCapabilities('sftp', ['posix-rename@openssh.com=1']);
        const hidden = describeCapabilities('sftp', []);

        expect(advertised.inventory).toBe('advertised');
        expect(advertised.server.atomicReplace.state).toBe('supported');
        expect(advertised.server.pathPermissions.state).toBe('unknown');
        expect(hidden.inventory).toBe('unavailable');
        expect(hidden.server.atomicReplace.state).toBe('unknown');
    });
});
