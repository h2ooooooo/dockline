import {checkLockfile} from './check-lockfile.mjs';
import {assertNoLocalDocumentationScratch} from './publication-policy.mjs';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await checkLockfile(repository);

const ignored = new Set([
    '.git',
    '.idea',
    '.serena',
    '.codex',
    '.vscode',
    '.scratch',
    '.local-dev',
    '.site',
    '.turbo',
    'node_modules',
    'dist',
    'coverage',
]);
const credentials = /(?:gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}/;
const machinePath = /[A-Za-z]:[\\/]git[\\/]|[A-Za-z]:[\\/]Users[\\/]aj(?:[\\/]|\b)/i;
const internalNarrative = /I have made the user aware|in our conversation|implementation agent|implementing agent|agent handoff|progress report/i;

async function inspectText(filename, bytes) {
    if (bytes.includes(0)) {
        return;
    }

    const text = bytes.toString('utf8');

    assert.ok(!credentials.test(text), 'Potential credential in ' + filename);
    assert.ok(!machinePath.test(text), 'Machine-specific path in ' + filename);

    if (filename.endsWith('.md') && !/third-party|license/i.test(filename)) {
        assert.ok(!text.includes('\u2014'), 'Em dash in ' + filename);
        assert.ok(!internalNarrative.test(text), 'Internal drafting text in ' + filename);
        assert.ok(!text.includes('\uE200cite'), 'Unresolved citation in ' + filename);
    }
}

async function walk(directory, prefix = '') {
    const files = [];

    for (const entry of await readdir(directory, {withFileTypes: true})) {
        if (ignored.has(entry.name) || /\.(tgz|log|tsbuildinfo)$/.test(entry.name)) {
            continue;
        }

        const filename = prefix + entry.name;

        if (entry.isDirectory()) {
            if (/^docs\/(public|audit|reviews|\.vitepress\/cache)\//.test(filename + '/')) {
                continue;
            }

            files.push(...await walk(path.join(directory, entry.name), filename + '/'));
        } else if (entry.isFile()) {
            files.push(filename);
        }
    }

    return files;
}

let files;

if (existsSync(path.join(repository, '.git'))) {
    const result = spawnSync('git', [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
    ],
    {cwd: repository, encoding: 'utf8', windowsHide: true});

    assert.equal(result.status, 0, 'Cannot inventory repository files');
    files = [...new Set(result.stdout.split('\0').filter(Boolean))];
} else {
    files = await walk(repository);
}

for (const filename of files) {
    assertNoLocalDocumentationScratch(filename);

    if (!existsSync(path.join(repository, filename))) {
        continue;
    }

    assert.ok(!filename.split('/').some(part => ignored.has(part)), 'Local/generated file included: ' + filename);
    assert.ok(!/(^|\/)(\.env(?:\..+)?|\.npmrc|local-packages\.json)$/.test(filename) || filename.endsWith('.env.example'),
        'Local configuration included: ' + filename);
    assert.ok(!/\.(tgz|log|tsbuildinfo)$/.test(filename), 'Generated archive included: ' + filename);
    await inspectText(filename, await readFile(path.join(repository, filename)));
}

const packageDirectories = (await readdir(path.join(repository, 'packages'))).map(name => path.join(repository, 'packages', name));

for (const directory of [repository, ...packageDirectories]) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));

    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const version of Object.values(manifest[group] ?? {})) {
            assert.ok(!/^(file:|link:|workspace:|\.\.?[/\\]|[A-Za-z]:)/.test(version), manifest.name + ': local dependency');
        }
    }
}

const npmCli = process.env.npm_execpath;

assert.ok(npmCli, 'Run through npm run check:publication');

const result = spawnSync(process.execPath, [
    npmCli,
    'pack',
    '--workspaces',
    '--dry-run',
    '--ignore-scripts',
    '--json',
], {cwd: repository, encoding: 'utf8', windowsHide: true});

assert.equal(result.status, 0, 'Cannot inventory npm packages');

const output = JSON.parse(result.stdout);
const packed = Array.isArray(output) ? output : Object.values(output);

for (const item of packed) {
    let folder;

    for (const candidate of packageDirectories) {
        const manifest = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));

        if (manifest.name === item.name) {
            folder = candidate;
            assert.equal(manifest.private, undefined, item.name + ': package is private');
            assert.equal(manifest.license, 'MIT');
            assert.equal(manifest.publishConfig?.access, 'public');
            assert.ok(manifest.repository?.url?.startsWith('git+https://github.com/'));
        }
    }

    assert.ok(folder, 'Unknown packed package');

    for (const required of ['LICENSE', 'README.md', 'package.json']) {
        assert.ok(item.files.some(file => file.path === required), item.name + ': missing ' + required);
    }

    for (const file of item.files) {
        assert.ok(!/(^|\/)(node_modules|tests|\.local-dev|\.scratch|AGENTS?\.md)(\/|$)|\.tgz$|handoff|progress-report/i.test(file.path),
            item.name + ': unintended packed file ' + file.path);
        await inspectText(item.name + '/' + file.path, await readFile(path.join(folder, file.path)));
    }
}

console.log('Public source and npm inventories checked: ' + files.length + ' repository files, ' + packed.length + ' packages.');
