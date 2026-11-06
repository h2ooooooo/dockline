import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {argument, artifactPackages} from './package-artifacts.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const ownPackages = new Set();

assert.ok(npmCli, 'Run through npm run dev:packages');

for (const directory of await readdir(path.join(repository, 'packages'))) {
    const manifest = JSON.parse(await readFile(path.join(repository, 'packages', directory, 'package.json'), 'utf8'));

    ownPackages.add(manifest.name);
}

const packages = (await artifactPackages(argument('--artifacts'))).filter(item => !ownPackages.has(item.name));

assert.ok(packages.length, 'No external development packages selected');

const args = [
    npmCli,
    'install',
    '--no-save',
    '--package-lock=false',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
];

if (process.argv.includes('--offline')) {
    args.push('--offline');
}

args.push(...packages.map(item => item.file));

const result = spawnSync(process.execPath, args, {cwd: repository, stdio: 'inherit', windowsHide: true});

assert.equal(result.status, 0, 'Development artifact installation failed');
console.log('Installed explicit tarballs without changing dependency declarations or lockfiles.');
