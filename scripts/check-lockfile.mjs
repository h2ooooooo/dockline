import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, URL} from 'node:url';

export async function workspaceManifests(repository) {
    const entries = [];

    for (const folder of await readdir(path.join(repository, 'packages'), {withFileTypes: true})) {
        if (!folder.isDirectory()) {
            continue;
        }

        const relative = 'packages/' + folder.name;
        const manifest = JSON.parse(await readFile(path.join(repository, relative, 'package.json'), 'utf8'));

        entries.push({relative, manifest});
    }

    return entries;
}

export async function checkLockfile(repository, candidates) {
    const manifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(repository, 'package-lock.json'), 'utf8'));
    const workspaces = new Map((await workspaceManifests(repository)).map(entry => [entry.relative, entry.manifest]));

    assert.equal(lock.lockfileVersion, 3, 'Use the declared npm version to generate a version 3 lockfile');
    assert.equal(lock.name, manifest.name, 'Lockfile name differs from package.json');
    assert.equal(lock.version, manifest.version, 'Lockfile version differs from package.json');

    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.deepEqual(lock.packages[''][group] ?? {}, manifest[group] ?? {}, 'Root lockfile differs: ' + group);
    }

    for (const [location, entry] of Object.entries(lock.packages)) {
        if (entry.link) {
            assert.ok(workspaces.has(entry.resolved), 'Workspace link leaves the owned repository: ' + location);

            continue;
        }

        if (!location || workspaces.has(location)) {
            continue;
        }

        if (entry.resolved) {
            assert.ok(entry.resolved.startsWith('https://'), 'Nonportable lockfile resolution: ' + location);

            const url = new URL(entry.resolved);

            assert.ok(!url.username && !url.password, 'Credentials must not appear in lockfile URLs');
            assert.ok(!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local registry URL in lockfile');
        }

        const name = entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);

        if (name.startsWith('@jalsoedesign/')) {
            const tarball = 'https://registry.npmjs.org/' + name + '/-/' + name.split('/')[1] + '-' + entry.version + '.tgz';

            assert.equal(entry.resolved, tarball, 'Family dependency must use its public npm URL: ' + name);
            assert.match(entry.integrity ?? '', /^sha512-[A-Za-z0-9+/]+=*$/, 'Missing release integrity: ' + name);

            const candidate = candidates?.get(name);

            if (candidate) {
                assert.equal(entry.version, candidate.version, 'Lockfile does not match the selected release version: ' + name);
                assert.equal(entry.integrity, candidate.integrity, 'Lockfile does not match the verified release artifact: ' + name);
            }
        }
    }

    return lock;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const repository = fileURLToPath(new URL('../', import.meta.url));

    await checkLockfile(repository);
    console.log('Root lockfile matches manifests and contains only portable dependency resolutions.');
}
