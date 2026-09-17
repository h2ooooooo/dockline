import {spawnSync} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const name = process.argv[2];

if (![
    'abstract',
    'ftp-client',
    'sftp-client',
    'ssh-client',
    'core',
    'cli',
].includes(name)) {
    throw new TypeError('A valid workspace package name is required');
}

const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const buildArguments = ['core', 'cli'].includes(name) ? [] : ['--package', name];
const commands = [
    [path.join(root, 'scripts/build.mjs'), ...buildArguments],
    [vitest, 'run', `packages/${name}/tests`, ...process.argv.slice(3)],
];

for (const arguments_ of commands) {
    const result = spawnSync(process.execPath, arguments_, {cwd: root, stdio: 'inherit', windowsHide: true});

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
    }
}
