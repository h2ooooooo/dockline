import {lstat, realpath, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const packages = [
    'abstract',
    'ftp-client',
    'sftp-client',
    'core',
    'cli',
];
const arguments_ = process.argv.slice(2);
const target = arguments_[0] === '--package' ? arguments_[1] : undefined;

if (arguments_.length > 0 && (arguments_.length !== 2 || !target || !packages.includes(target))) {
    throw new TypeError('Usage: node scripts/build.mjs [--package abstract|ftp-client|sftp-client|core|cli]');
}

const selected = target === 'cli' ? ['abstract', 'core', 'cli'] :
    target === 'abstract' ? ['abstract'] :
        target === 'core' ? ['abstract', 'core'] :
            target ? ['abstract', target] : packages;
const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');

async function cleanOutput(directory) {
    const owner = await realpath(directory);
    const relative = path.relative(root, owner);
    const output = path.join(owner, 'dist');
    const info = await lstat(output).catch(error => {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    });

    if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        path.dirname(output) !== owner ||
        info?.isSymbolicLink() ||
        (info &&
            await realpath(output) !== output)
    ) {
        throw new Error('Refusing to clean an unexpected build output');
    }

    await rm(output, {recursive: true, force: true});
}

for (const name of selected) {
    const directory = path.join(root, 'packages', name);

    await cleanOutput(directory);

    const result = spawnSync(process.execPath, [compiler, '--build', '--force', path.join(directory, 'tsconfig.json')], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
    }
}
