import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;

assert.ok(npmCli, 'Run through npm run check:consumer');

const directory = await mkdtemp(path.join(tmpdir(), 'dockline modular consumer '));
const artifacts = path.join(directory, 'artifacts');
const results = [];

await mkdir(artifacts);

async function command(label, args, cwd) {
    let output = '';
    const child = spawn(process.execPath, args, {cwd, windowsHide: true});

    child.stdout.on('data', chunk => {
        output += chunk;
    });
    child.stderr.on('data', chunk => {
        output += chunk;
    });

    const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });

    await writeFile(path.join(directory, `${label}.log`), output);
    results.push({label, exitCode: code});
    await writeFile(path.join(directory, 'verification.json'), JSON.stringify({directory, node: process.version, results}, null, 4));

    assert.equal(code, 0, `${label}: ${output.slice(-7000)}`);
    console.log(`${label}: PASS`);

    return output;
}

const packedOutput = JSON.parse(await command('pack', [
    npmCli,
    'pack',
    '--workspaces',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    artifacts,
], root));
const packed = Array.isArray(packedOutput) ? packedOutput : Object.values(packedOutput);
const tarballs = Object.fromEntries(packed.map(item => [
    item.name,
    `file:${path.join(artifacts, item.filename).split(path.sep).join('/')}`,
]));

assert.deepEqual(Object.keys(tarballs).sort(), [
    '@jalsoedesign/dockline-abstract',
    '@jalsoedesign/dockline-cli',
    '@jalsoedesign/dockline-core',
    '@jalsoedesign/dockline-ftp-client',
    '@jalsoedesign/dockline-sftp-client',
    '@jalsoedesign/dockline-ssh-client',
]);

const runtimePreamble = `import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
function absent(name) {
    assert.throws(() => require.resolve(name), error => error.code === 'MODULE_NOT_FOUND', name + ' should not be installed');
}
function notLoaded(fragment) {
    assert.ok(!Object.keys(require.cache).some(filename => filename.replaceAll('\\\\', '/').includes(fragment)), fragment + ' should not be loaded');
}
`;

const sdkTypes = `import {Dockline, MissingClientPackageError, type TransferConfig, type TransferAdapter} from '@jalsoedesign/dockline-core';
const config: TransferConfig = {
    protocol: 'sftp', host: 'fixture.invalid', username: 'fixture', maxBytes: 1024,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => challenge.fingerprint === 'SHA256:verified-independently',
    acceptTrustPolicy: () => false,
};
const example = async () => {
    const remote = Dockline.create(config);
    const adapter: TransferAdapter = remote.connector;
    await remote.downloadFile('large.bin', './large.bin', {maxBytes: Infinity});
    await remote.uploadFile('./small.txt', 'small.txt', {maxBytes: 1024});
    await adapter.read('file.txt', {maxBytes: 0});
    return adapter;
};
void [example, MissingClientPackageError];
`;

const cliTypes = `import {runCli, createProgram, loadCliConfig, type LoadedCliConfig, type CliContext} from '@jalsoedesign/dockline-cli';
const context: CliContext = {};
const run = () => runCli(['--help'], context);
const configIdentity = (config: LoadedCliConfig) => config;
void [run, createProgram, loadCliConfig, configIdentity];`;

const cliRuntime = `const {spawnSync} = await import('node:child_process');
const {writeFileSync, existsSync} = await import('node:fs');
const path = await import('node:path');
const {runCli, createProgram, loadCliConfig} = await import('@jalsoedesign/dockline-cli');
assert.equal(typeof runCli, 'function');
assert.equal(typeof createProgram, 'function');
assert.equal(typeof loadCliConfig, 'function');
notLoaded('/basic-ftp/');
notLoaded('/ssh2-sftp-client/');
notLoaded('/ssh2/');
const executable = path.join(path.dirname(require.resolve('@jalsoedesign/dockline-cli/package.json')), 'dist/bin.js');
assert.ok(existsSync(path.join('node_modules/.bin', process.platform === 'win32' ? 'dockline.cmd' : 'dockline')));
function cli(...args) {
    return spawnSync(process.execPath, [executable, ...args], {encoding: 'utf8', windowsHide: true, timeout: 10000});
}
const help = cli('--help');
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /download/);
assert.match(help.stdout, /upload/);
assert.match(help.stdout, /list/);
assert.match(help.stdout, /remove/);
const version = cli('--version');
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), require('@jalsoedesign/dockline-cli/package.json').version);
function configuredList(protocol) {
    const connection = {
        protocol, host: '127.0.0.1', port: 1, username: 'fixture', password: 'fixture-password',
        timeoutMs: 300, maxTransientRetries: 0,
    };
    if (protocol === 'sftp') connection.trust = {fingerprint: 'SHA256:' + Buffer.alloc(32).toString('base64').replace(/=+$/, '')};
    writeFileSync('server.yml', JSON.stringify({version: 1, connection}));
    const result = cli('list', '--config', 'server.yml', '--path', '/', '--json');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    return output.error;
}
`;

const scenarios = [
    {
        name: 'abstract-only',
        packages: ['abstract'],
        types: `import {ConnectorPool, ResourceLimitError, type TransferAdapter, type SftpTransferConfig} from '@jalsoedesign/dockline-abstract';
const config: SftpTransferConfig = {protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'};
const identity = (adapter: TransferAdapter) => adapter;
void [ConnectorPool, ResourceLimitError, identity, config];`,
        runtime: `const shared = await import('@jalsoedesign/dockline-abstract');
assert.equal(typeof shared.ConnectorPool, 'function');
for (const name of ['@jalsoedesign/dockline-core', '@jalsoedesign/dockline-ftp-client', '@jalsoedesign/dockline-sftp-client', 'basic-ftp', 'ssh2-sftp-client', 'ssh2']) absent(name);`,
    },
    {
        name: 'core-only',
        packages: ['abstract', 'core'],
        types: sdkTypes,
        runtime: `const {Dockline, MissingClientPackageError, UnsupportedProtocolError} = await import('@jalsoedesign/dockline-core');
for (const name of ['@jalsoedesign/dockline-ftp-client', '@jalsoedesign/dockline-sftp-client', 'basic-ftp', 'ssh2-sftp-client', 'ssh2']) absent(name);
for (const protocol of ['ftp', 'ftps', 'ftps-implicit', 'sftp']) {
    const packageName = protocol === 'sftp' ? '@jalsoedesign/dockline-sftp-client' : '@jalsoedesign/dockline-ftp-client';
    assert.throws(() => Dockline.create({protocol, host: 'fixture.invalid', username: 'fixture'}), error => {
        assert.ok(error instanceof MissingClientPackageError);
        assert.equal(error.code, 'DOCKLINE_CLIENT_NOT_INSTALLED');
        assert.equal(error.protocol, protocol);
        assert.equal(error.packageName, packageName);
        assert.equal(error.installCommand, 'npm install ' + packageName);
        return true;
    });
}
assert.throws(() => Dockline.create({protocol: 'https', host: 'fixture.invalid', username: 'fixture'}), UnsupportedProtocolError);
assert.throws(() => Dockline.create({protocol: 'ftp', host: 'fixture.invalid', username: 'fixture', port: 0}), RangeError);`,
    },
    {
        name: 'ftp-only',
        packages: ['abstract', 'ftp-client'],
        types: `import {FtpConnector, createConnector, type FtpTransferConfig} from '@jalsoedesign/dockline-ftp-client';
const config: FtpTransferConfig = {protocol: 'ftps', host: 'fixture.invalid', username: 'fixture', secureOptions: {rejectUnauthorized: true}};
const client: FtpConnector = createConnector(config);
void client;`,
        runtime: `const {FtpConnector, createConnector, AuthError} = await import('@jalsoedesign/dockline-ftp-client');
const {AuthError: SharedAuthError} = await import('@jalsoedesign/dockline-abstract');
assert.equal(AuthError, SharedAuthError);
for (const name of ['@jalsoedesign/dockline-core', '@jalsoedesign/dockline-sftp-client', 'ssh2-sftp-client', 'ssh2']) absent(name);
const client = createConnector({protocol: 'ftp', host: 'fixture.invalid', username: 'fixture'});
assert.ok(client instanceof FtpConnector);
await client.disconnect();`,
    },
    {
        name: 'sftp-only',
        packages: ['abstract', 'sftp-client'],
        types: `import {SftpConnector, KnownHostsStore, createConnector, type SftpTransferConfig} from '@jalsoedesign/dockline-sftp-client';
const config: SftpTransferConfig = {protocol: 'sftp', host: 'fixture.invalid', username: 'fixture', requireTrustPolicy: true, hasTrustPolicy: () => false, acceptTrustPolicy: () => false};
const client: SftpConnector = createConnector(config);
void [client, KnownHostsStore];`,
        runtime: `const {SftpConnector, createConnector, AuthError} = await import('@jalsoedesign/dockline-sftp-client');
const {AuthError: SharedAuthError} = await import('@jalsoedesign/dockline-abstract');
assert.equal(AuthError, SharedAuthError);
for (const name of ['@jalsoedesign/dockline-core', '@jalsoedesign/dockline-ftp-client', 'basic-ftp']) absent(name);
const client = createConnector({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'});
assert.ok(client instanceof SftpConnector);
await client.disconnect();`,
    },
    {
        name: 'ssh-only',
        packages: ['abstract', 'sftp-client', 'ssh-client'],
        types: `import {SshClient, type ExecResult} from '@jalsoedesign/dockline-ssh-client';
const client = new SshClient({host: 'fixture.invalid', port: 22, username: 'fixture'});
const execute = () => client.withConnection(async server => { const result: ExecResult = await server.exec('uptime'); return result.code; });
void execute;`,
        runtime: `const {SshClient} = await import('@jalsoedesign/dockline-ssh-client');
assert.equal(typeof SshClient, 'function');
for (const name of ['@jalsoedesign/dockline-core', '@jalsoedesign/dockline-ftp-client', 'basic-ftp']) absent(name);`,
    },
    {
        name: 'core-ftp',
        packages: ['abstract', 'core', 'ftp-client'],
        types: sdkTypes,
        runtime: `const {Dockline, MissingClientPackageError, AuthError} = await import('@jalsoedesign/dockline-core');
notLoaded('/basic-ftp/');
for (const name of ['@jalsoedesign/dockline-sftp-client', 'ssh2-sftp-client', 'ssh2']) absent(name);
for (const protocol of ['ftp', 'ftps', 'ftps-implicit']) {
    const remote = Dockline.create({protocol, host: 'fixture.invalid', username: 'fixture'});
    const {FtpConnector, AuthError: ClientAuthError} = await import('@jalsoedesign/dockline-ftp-client');
    assert.ok(remote.connector instanceof FtpConnector);
    assert.equal(AuthError, ClientAuthError);
    await remote.disconnect();
}
assert.throws(() => Dockline.create({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'}), MissingClientPackageError);`,
    },
    {
        name: 'core-sftp',
        packages: ['abstract', 'core', 'sftp-client'],
        types: sdkTypes,
        runtime: `const {Dockline, MissingClientPackageError, AuthError} = await import('@jalsoedesign/dockline-core');
notLoaded('/ssh2-sftp-client/');
notLoaded('/ssh2/');
for (const name of ['@jalsoedesign/dockline-ftp-client', 'basic-ftp']) absent(name);
const remote = Dockline.create({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'});
const {SftpConnector, AuthError: ClientAuthError} = await import('@jalsoedesign/dockline-sftp-client');
assert.ok(remote.connector instanceof SftpConnector);
assert.equal(AuthError, ClientAuthError);
await remote.disconnect();
assert.throws(() => Dockline.create({protocol: 'ftp', host: 'fixture.invalid', username: 'fixture'}), MissingClientPackageError);`,
    },
    {
        name: 'all-clients',
        packages: ['abstract', 'core', 'ftp-client', 'sftp-client'],
        types: sdkTypes,
        runtime: `const {Dockline, AuthError} = await import('@jalsoedesign/dockline-core');
notLoaded('/basic-ftp/');
notLoaded('/ssh2-sftp-client/');
const ftp = Dockline.create({protocol: 'ftp', host: 'fixture.invalid', username: 'fixture'});
notLoaded('/ssh2-sftp-client/');
const sftp = Dockline.create({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'});
const {FtpConnector, AuthError: FtpAuthError} = await import('@jalsoedesign/dockline-ftp-client');
const {SftpConnector, AuthError: SftpAuthError} = await import('@jalsoedesign/dockline-sftp-client');
const {AuthError: SharedAuthError} = await import('@jalsoedesign/dockline-abstract');
assert.ok(ftp.connector instanceof FtpConnector);
assert.ok(sftp.connector instanceof SftpConnector);
assert.equal(AuthError, SharedAuthError);
assert.equal(AuthError, FtpAuthError);
assert.equal(AuthError, SftpAuthError);
await ftp.disconnect();
await sftp.disconnect();`,
    },
    {
        name: 'cli-only',
        packages: ['abstract', 'core', 'cli'],
        types: cliTypes,
        runtime: cliRuntime + `for (const name of ['@jalsoedesign/dockline-ftp-client', '@jalsoedesign/dockline-sftp-client', 'basic-ftp', 'ssh2-sftp-client', 'ssh2']) absent(name);
for (const protocol of ['ftp', 'sftp']) {
    const failure = configuredList(protocol);
    assert.equal(failure.code, 'DOCKLINE_CLIENT_NOT_INSTALLED');
    assert.match(failure.message, /npm install @jalsoedesign\\/dockline-(?:sftp|ftp)-client/);
}`,
    },
    {
        name: 'cli-ftp',
        packages: ['abstract', 'core', 'cli', 'ftp-client'],
        types: cliTypes,
        runtime: cliRuntime + `for (const name of ['@jalsoedesign/dockline-sftp-client', 'ssh2-sftp-client', 'ssh2']) absent(name);
assert.notEqual(configuredList('ftp').code, 'DOCKLINE_CLIENT_NOT_INSTALLED');
assert.equal(configuredList('sftp').code, 'DOCKLINE_CLIENT_NOT_INSTALLED');`,
    },
    {
        name: 'cli-sftp',
        packages: ['abstract', 'core', 'cli', 'sftp-client'],
        types: cliTypes,
        runtime: cliRuntime + `for (const name of ['@jalsoedesign/dockline-ftp-client', 'basic-ftp']) absent(name);
assert.notEqual(configuredList('sftp').code, 'DOCKLINE_CLIENT_NOT_INSTALLED');
assert.equal(configuredList('ftp').code, 'DOCKLINE_CLIENT_NOT_INSTALLED');`,
    },
];

async function addDocumentationExamples(target, scenario) {
    const readmePackages = {
        'abstract-only': 'abstract',
        'core-only': 'core',
        'ftp-only': 'ftp-client',
        'sftp-only': 'sftp-client',
        'ssh-only': 'ssh-client',
    };
    const workspace = readmePackages[scenario];

    if (workspace) {
        const markdown = await readFile(path.join(root, 'packages', workspace, 'README.md'), 'utf8');
        const examples = [...markdown.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map(match => match[1]);

        assert.ok(examples.length > 0, workspace + ' README requires a TypeScript example');

        for (const [index, example] of examples.entries()) {
            await writeFile(path.join(target, 'package-readme-' + index + '.ts'), example);
        }
    }

    const protocols = scenario === 'core-ftp' ? ['ftp'] : scenario === 'core-sftp' ? ['sftp'] : [];

    for (const protocol of protocols) {
        const filename = `docs/${protocol}/quick-start.md`;
        const markdown = await readFile(path.join(root, filename), 'utf8');
        const examples = [...markdown.matchAll(/```ts\r?\n([\s\S]*?)```/g)].map(match => match[1]);

        assert.ok(examples.length > 1, `${filename} requires a complete example and everyday recipes`);

        for (const [index, example] of examples.entries()) {
            const source = index === 0 ? example : `${examples[0]}\n\nasync function documentedRecipe() {\n${example}\n}\n`;

            await writeFile(path.join(target, `quick-start-${protocol}-${index + 1}.ts`), source);
        }

        console.log(`Prepared ${examples.length} ${protocol.toUpperCase()} documentation examples in ${scenario}`);
    }

    if (scenario === 'all-clients') {
        const readme = await readFile(path.join(root, 'README.md'), 'utf8');
        const example = /```ts\r?\n([\s\S]*?)```/.exec(readme);

        assert.ok(example, 'README must contain a TypeScript quick start');
        await writeFile(path.join(target, 'readme-example.ts'), example[1]);
    }
}

for (const scenario of scenarios) {
    const target = path.join(directory, scenario.name);

    await mkdir(target);
    await writeFile(path.join(target, 'package.json'), JSON.stringify({
        name: `dockline-${scenario.name}-consumer`,
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(scenario.packages.map(name => [`@jalsoedesign/dockline-${name}`, tarballs[`@jalsoedesign/dockline-${name}`]])),
        devDependencies: {typescript: '6.0.3', '@types/node': '22.20.2'},
        allowScripts: {'ssh2': false, 'cpu-features': false},
    }, null, 4));
    await writeFile(path.join(target, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            types: ['node'],
        },
        include: ['*.ts'],
    }, null, 4));
    await writeFile(path.join(target, 'consumer.ts'), scenario.types);
    await writeFile(path.join(target, 'runtime.mjs'), runtimePreamble + scenario.runtime);
    await addDocumentationExamples(target, scenario.name);
    await command(`${scenario.name}-install`, [
        npmCli,
        'install',
        '--ignore-scripts',
        '--offline=false',
        '--no-audit',
        '--no-fund',
    ], target);
    await command(`${scenario.name}-types`, [path.join(target, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], target);
    await command(`${scenario.name}-runtime`, [path.join(target, 'runtime.mjs')], target);

    const lock = JSON.parse(await readFile(path.join(target, 'package-lock.json'), 'utf8'));
    const installed = Object.keys(lock.packages).filter(name => /^node_modules\/@jalsoedesign\/dockline-/.test(name)).sort();

    assert.deepEqual(installed, scenario.packages.map(name => `node_modules/@jalsoedesign/dockline-${name}`).sort());
}

// Global installation has its own dependency tree and executable shims.
for (const selection of [[], ['ftp-client'], ['sftp-client']]) {
    const label = 'global-cli-' + (selection[0] ?? 'only');
    const target = path.join(directory, label);
    const prefix = path.join(target, 'prefix');
    const packages = ['abstract', 'core', 'cli', ...selection];

    await mkdir(target);
    await command(label + '-install', [
        npmCli,
        'install',
        '--global',
        '--prefix',
        prefix,
        '--ignore-scripts',
        '--offline=false',
        '--no-audit',
        '--no-fund',
        ...packages.map(name => tarballs['@jalsoedesign/dockline-' + name].slice(5)),
    ], target);

    const moduleRoot = path.join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules');
    const cliDirectory = path.join(moduleRoot, '@jalsoedesign', 'dockline-cli');
    const shim = path.join(prefix, ...(process.platform === 'win32' ? [] : ['bin']),
        process.platform === 'win32' ? 'dockline.cmd' : 'dockline');

    if (process.platform === 'win32') {
        assert.match(await readFile(shim, 'utf8'), /bin\.js/);
    } else {
        assert.equal(await realpath(shim), await realpath(path.join(cliDirectory, 'dist/bin.js')));
    }

    const version = JSON.parse(await readFile(path.join(root, 'packages/cli/package.json'), 'utf8')).version;
    const output = await command(label + '-version', [path.join(cliDirectory, 'dist/bin.js'), '--version'], target);

    assert.equal(output.trim(), version);
    await command(label + '-help', [path.join(cliDirectory, 'dist/bin.js'), '--help'], target);

    const harness = [
        "import assert from 'node:assert/strict';",
        "import {createRequire} from 'node:module';",
        'const require = createRequire(' + JSON.stringify(path.join(cliDirectory, 'package.json')) + ');',
        "const {Dockline, MissingClientPackageError} = require('@jalsoedesign/dockline-core');",
        'const installed = ' + JSON.stringify(selection) + ';',
        "for (const [protocol, client] of [['ftp', 'ftp-client'], ['sftp', 'sftp-client']]) {",
        "    const create = () => Dockline.create({protocol, host: 'fixture.invalid', username: 'fixture'});",
        '    if (installed.includes(client)) assert.equal(create().toJSON().protocol, protocol);',
        '    else assert.throws(create, MissingClientPackageError);',
        '}',
    ].join('\n');

    await writeFile(path.join(target, 'installed.mjs'), harness);
    await command(label + '-clients', [path.join(target, 'installed.mjs')], target);
}

// An installed package that fails internally must not be reported as merely absent.
const brokenConsumer = path.join(directory, 'core-only');
const brokenPackage = path.join(brokenConsumer, 'node_modules/@jalsoedesign/dockline-sftp-client');

await mkdir(brokenPackage, {recursive: true});
await writeFile(path.join(brokenPackage, 'package.json'), JSON.stringify({
    name: '@jalsoedesign/dockline-sftp-client',
    version: '1.0.0',
    type: 'module',
    exports: {'.': './index.js', './package.json': './package.json'},
}));
await writeFile(path.join(brokenPackage, 'index.js'), "import 'dockline-intentionally-missing-transitive-fixture';\n");
await writeFile(path.join(brokenConsumer, 'broken.mjs'), `import assert from 'node:assert/strict';
import {Dockline, MissingClientPackageError} from '@jalsoedesign/dockline-core';
assert.throws(() => Dockline.create({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'}), error => {
    assert.ok(!(error instanceof MissingClientPackageError));
    assert.equal(error.code, 'ERR_MODULE_NOT_FOUND');
    assert.match(error.message, /dockline-intentionally-missing-transitive-fixture/);
    return true;
});
`);
await command('broken-installed-client', [path.join(brokenConsumer, 'broken.mjs')], brokenConsumer);
await writeFile(path.join(brokenPackage, 'index.js'), 'export const incompatibleClient = true;\n');
await writeFile(path.join(brokenConsumer, 'incompatible.mjs'), `import assert from 'node:assert/strict';
import {Dockline, MissingClientPackageError} from '@jalsoedesign/dockline-core';
assert.throws(() => Dockline.create({protocol: 'sftp', host: 'fixture.invalid', username: 'fixture'}), error => {
    assert.ok(error instanceof TypeError);
    assert.ok(!(error instanceof MissingClientPackageError));
    assert.match(error.message, /compatible createConnector/);
    return true;
});
`);
await command('incompatible-installed-client', [path.join(brokenConsumer, 'incompatible.mjs')], brokenConsumer);

console.log(`${scenarios.length} local package combinations and three global CLI installations verified: ${directory}`);
