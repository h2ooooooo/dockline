import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const workspaces = [
    'abstract',
    'core',
    'ftp-client',
    'sftp-client',
    'cli',
];

assert.ok(npmCli, 'Run through npm run check:packages');

const result = spawnSync(process.execPath, [
    npmCli,
    'pack',
    '--workspaces',
    '--dry-run',
    '--ignore-scripts',
    '--json',
], {cwd: root, encoding: 'utf8', windowsHide: true});

assert.equal(result.status, 0, result.stderr);

const packResult = JSON.parse(result.stdout);
const packed = Array.isArray(packResult) ? packResult : Object.values(packResult);

assert.deepEqual(packed.map(item => item.name).sort(), workspaces.map(name => `@dockline/${name}`).sort());

for (const workspace of workspaces) {
    const directory = path.join(root, 'packages', workspace);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const item = packed.find(item => item.name === manifest.name);
    const files = new Set(item.files.map(file => file.path));

    assert.equal(manifest.repository.directory, `packages/${workspace}`);
    assert.equal(manifest.repository.url, 'git+https://github.com/h2ooooooo/dockline.git');

    for (const entry of Object.values(manifest.exports)) {
        for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
            assert.ok(files.has(target.replace(/^\.\//, '')), `Missing export ${manifest.name}: ${target}`);
        }
    }

    for (const required of ['README.md', 'LICENSE']) {
        assert.ok(files.has(required), `${manifest.name} lacks ${required}`);
    }

    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
            assert.ok(!/^(file:|link:|workspace:)/.test(version), `Nonportable ${manifest.name} dependency ${name}`);
        }
    }

    for (const filename of files) {
        assert.ok(!/(^|\/)(tests|node_modules|\.git|\.scratch)(\/|$)/.test(filename), `Unexpected packed file ${filename}`);
    }

    const dependencies = Object.keys(manifest.dependencies ?? {});

    if (workspace === 'core') {
        assert.deepEqual(dependencies, ['@dockline/abstract']);
        assert.equal(manifest.optionalDependencies, undefined);

        for (const client of ['@dockline/ftp-client', '@dockline/sftp-client']) {
            assert.ok(manifest.peerDependencies[client]);
            assert.equal(manifest.peerDependenciesMeta[client].optional, true);
        }
    }

    if (workspace === 'cli') {
        assert.deepEqual(dependencies.sort(), ['@dockline/core', 'commander', 'yaml']);
        assert.equal(manifest.bin.dockline, './dist/bin.js');
        assert.ok(files.has('dist/bin.js'));
        assert.equal(manifest.optionalDependencies, undefined);
        assert.match(await readFile(path.join(directory, 'dist/bin.js'), 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);

        for (const client of ['@dockline/ftp-client', '@dockline/sftp-client']) {
            assert.ok(manifest.peerDependencies[client]);
            assert.equal(manifest.peerDependenciesMeta[client].optional, true);
        }
    }

    const prohibited = workspace === 'sftp-client' ?
        ['@dockline/core', '@dockline/ftp-client', 'basic-ftp'] :
        workspace === 'ftp-client' ?
            ['@dockline/core', '@dockline/sftp-client', 'ssh2-sftp-client', 'ssh2'] :
            [
                '@dockline/ftp-client',
                '@dockline/sftp-client',
                'basic-ftp',
                'ssh2-sftp-client',
                'ssh2',
            ];

    assert.ok(!dependencies.some(name => prohibited.includes(name)), `Unexpected dependency in ${manifest.name}`);

    if (workspace === 'core' || workspace === 'abstract' || workspace === 'cli') {
        for (const filename of files) {
            if (!filename.endsWith('.d.ts')) {
                continue;
            }

            const declaration = await readFile(path.join(directory, filename), 'utf8');

            assert.ok(!/(?:from\s*|import\s*\()['"](?:@dockline\/(?:ftp-client|sftp-client)|basic-ftp|ssh2(?:-sftp-client)?)['"]/.test(declaration),
                `Optional transport declaration leaked into ${manifest.name}/${filename}`);
        }
    }

    console.log(`Package contents passed: ${manifest.name}@${manifest.version}, ${files.size} files`);
}
