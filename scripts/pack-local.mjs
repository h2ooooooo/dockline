import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {argument} from './package-artifacts.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(argument('--output'));
const npmCli = process.env.npm_execpath;

assert.ok(npmCli, 'Run through npm run pack:local');
await mkdir(output, {recursive: true});

const result = spawnSync(process.execPath, [
    npmCli,
    'pack',
    '--workspaces',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    output,
], {cwd: repository, encoding: 'utf8', windowsHide: true});

assert.equal(result.status, 0, result.stderr || result.stdout);

const packed = JSON.parse(result.stdout);
const packages = (Array.isArray(packed) ? packed : Object.values(packed)).map(item => ({
    name: item.name,
    version: item.version,
    filename: item.filename,
    integrity: item.integrity,
}));
const manifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
const filename = manifest.name.replace(/^@/, '').replaceAll('/', '-') + '.packages.json';

await writeFile(path.join(output, filename), JSON.stringify(packages, null, 4) + '\n');
console.log('Packed ' + packages.length + ' built packages. No dependency checkout was built.');
