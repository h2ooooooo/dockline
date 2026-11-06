import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import {argument} from './package-artifacts.mjs';
import {checkLockfile, workspaceManifests} from './check-lockfile.mjs';
import {startReleaseRegistry} from './release-registry.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;

assert.ok(npmCli, 'Run through npm run release:lock or npm run check:bootstrap');

function run(args, directory, environment = process.env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [npmCli, ...args], {
            cwd: directory,
            env: environment,
            stdio: 'inherit',
            windowsHide: true,
        });

        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('Bootstrap npm command failed: ' + args.join(' '))));
    });
}

const directory = await mkdtemp(path.join(tmpdir(), 'release-bootstrap-'));
const registry = await startReleaseRegistry(argument('--artifacts'), process.argv.includes('--lock'));

try {
    if (process.argv.includes('--lock')) {
        await cp(path.join(repository, 'package.json'), path.join(directory, 'package.json'));

        for (const workspace of await workspaceManifests(repository)) {
            await mkdir(path.join(directory, workspace.relative), {recursive: true});
            await cp(path.join(repository, workspace.relative, 'package.json'), path.join(directory, workspace.relative, 'package.json'));
        }

        if (!process.argv.includes('--fresh')) {
            try {
                const lock = JSON.parse(await readFile(path.join(repository, 'package-lock.json'), 'utf8'));

                for (const [location, entry] of Object.entries(lock.packages)) {
                    if (!entry.link && /^(file:|link:|http:)/.test(entry.resolved ?? '')) {
                        delete lock.packages[location];
                    }
                }

                await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock, null, 4));
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }
    } else {
        const excluded = new Set([
            '.git',
            'node_modules',
            'dist',
            'coverage',
            '.local-dev',
            '.scratch',
            '.site',
            '.turbo',
            '.idea',
            '.serena',
            '.codex',
            '.vscode',
        ]);

        await cp(repository, directory, {
            recursive: true,
            filter(source) {
                const relative = path.relative(repository, source);
                const basename = path.basename(source);

                return !relative.split(path.sep).some(part => excluded.has(part)) &&
                    !relative.split(path.sep).join('/').includes('.vitepress/cache') &&
                    !/^\.env(?:\.|$)|^\.npmrc$|\.(?:tgz|log|tsbuildinfo)$/.test(basename);
            },
        });
    }

    // These settings live only in the temporary checkout and never change npm user configuration.
    await writeFile(path.join(directory, '.npmrc'), 'registry=' + registry.url + '\n@jalsoedesign:registry=' + registry.url + '\n');

    if (process.argv.includes('--lock')) {
        await run([
            'install',
            '--package-lock-only',
            '--ignore-scripts',
            '--replace-registry-host=never',
            '--no-audit',
            '--no-fund',
        ], directory);
        await checkLockfile(directory, registry.candidates);

        const target = path.join(repository, 'package-lock.json');

        try {
            const previous = await readFile(target);

            await mkdir(path.join(repository, '.local-dev/lock-backups'), {recursive: true});
            await writeFile(path.join(repository, '.local-dev/lock-backups/package-lock.before-release.json'), previous);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }

        await cp(path.join(directory, 'package-lock.json'), target);
        console.log('Generated portable lockfile from public metadata and verified release artifact hashes.');
    } else {
        const before = await readFile(path.join(directory, 'package-lock.json'), 'utf8');

        await checkLockfile(directory, registry.candidates);

        // Resolve transport through the temporary registry; retain every locked version and integrity.
        // The source lock remains canonical and npm remote-package restrictions remain enabled.
        const transport = JSON.parse(before);

        for (const entry of Object.values(transport.packages)) {
            if (entry.resolved?.startsWith('https://registry.npmjs.org/')) {
                delete entry.resolved;
            }
        }

        await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(transport, null, 4));

        try {
            await run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
        } finally {
            await writeFile(path.join(directory, 'package-lock.json'), before);
        }

        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        const commands = [
            'build',
            'lint',
            'test',
            'docs:api:check',
            'docs:imports:check',
            'docs:examples:check',
        ];

        for (const command of commands) {
            if (manifest.scripts[command]) {
                await run(['run', command], directory);
            }
        }

        assert.equal(await readFile(path.join(directory, 'package-lock.json'), 'utf8'), before, 'Bootstrap checks rewrote the lockfile');
        console.log('Fresh checkout, locked bootstrap install and checks passed: ' + directory);
    }
} finally {
    await registry.close();
}
