import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkLockfile} from './check-lockfile.mjs';

async function fixture(run) {
    const directory = await mkdtemp(path.join(tmpdir(), 'portable-lock-test-'));
    const manifest = {
        name: 'fixture',
        version: '1.0.0',
        private: true,
        workspaces: ['packages/*'],
    };
    const lock = {
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
            '': manifest,
            'packages/core': {name: '@fixture/core', version: '1.0.0'},
            'node_modules/@fixture/core': {link: true, resolved: 'packages/core'},
            'node_modules/@jalsoedesign/example': {
                version: '0.1.0',
                resolved: 'https://registry.npmjs.org/@jalsoedesign/example/-/example-0.1.0.tgz',
                integrity: 'sha512-Zml4dHVyZQ==',
            },
        },
    };

    await mkdir(path.join(directory, 'packages/core'), {recursive: true});
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(path.join(directory, 'packages/core/package.json'), JSON.stringify(lock.packages['packages/core']));

    try {
        await run(directory, lock, async () => {
            await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock));
        });
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
}

test('portable locks allow only owned workspace links and canonical family tarballs', async () => {
    await fixture(async (directory, lock, save) => {
        await save();
        await checkLockfile(directory);
        lock.packages['node_modules/@fixture/core'].resolved = '../another-checkout/packages/core';
        await save();
        await assert.rejects(checkLockfile(directory), /leaves the owned repository/);
    });
});

test('local archives and local registry URLs cannot enter a public lockfile', async () => {
    await fixture(async (directory, lock, save) => {
        for (const resolved of ['file:../another-checkout/release.tgz', 'http://127.0.0.1:1234/example.tgz', 'https://localhost/example.tgz']) {
            lock.packages['node_modules/@jalsoedesign/example'].resolved = resolved;
            await save();
            await assert.rejects(checkLockfile(directory));
        }
    });
});

test('candidate integrity and manifest drift fail before an install', async () => {
    await fixture(async (directory, lock, save) => {
        await save();
        await assert.rejects(checkLockfile(directory, new Map([['@jalsoedesign/example', {version: '0.1.0', integrity: 'sha512-ZGlmZmVyZW50'}]])), /verified release artifact/);

        lock.packages[''].devDependencies = {unexpected: '1.0.0'};
        await save();
        await assert.rejects(checkLockfile(directory), /Root lockfile differs/);
    });
});
