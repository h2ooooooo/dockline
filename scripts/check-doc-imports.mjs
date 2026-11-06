import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumerFlag = process.argv.indexOf('--consumer');
const consumer = consumerFlag < 0 ? repository : path.resolve(process.argv[consumerFlag + 1]);
const manifests = [JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))];

for (const directory of await readdir(path.join(repository, 'packages'))) {
    manifests.push(JSON.parse(await readFile(path.join(repository, 'packages', directory, 'package.json'), 'utf8')));
}

const declared = new Set(manifests.flatMap(manifest => [
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
]));
const imports = [];
let optionalModules = 0;
const files = [];
const excluded = new Set([
    'node_modules',
    'dist',
    '.vitepress',
    '.local-dev',
    '.scratch',
    'audit',
    'reviews',
]);

async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        if (excluded.has(entry.name) || entry.isSymbolicLink()) {
            continue;
        }

        const filename = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            await visit(filename);
        } else if (/\.md$/i.test(entry.name)) {
            files.push(filename);
        }
    }
}

await visit(path.join(repository, 'docs'));
await visit(path.join(repository, 'packages'));
files.push(path.join(repository, 'README.md'));

for (const filename of files) {
    const markdown = await readFile(filename, 'utf8');

    for (const match of markdown.matchAll(/import\s+(?:type\s+)?\{([^{}]+)\}\s+from\s+['"](@jalsoedesign\/[^'"\n]+)['"]/g)) {
        for (const field of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
            const name = field.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();

            assert.match(name, /^[A-Za-z_$][\w$]*$/, 'Invalid documentation import in ' + filename);
            imports.push({name, module: match[2], file: path.relative(repository, filename)});
        }
    }
}

const filename = path.join(consumer, 'documentation-imports.mts');
const installedImports = consumerFlag < 0 ? imports.filter(item => {
    const resolution = ts.resolveModuleName(
        item.module, filename, {moduleResolution: ts.ModuleResolutionKind.NodeNext}, ts.sys,
    );
    const resolved = resolution.resolvedModule;
    const expected = declared.has(item.module.split('/').slice(0, 2).join('/'));

    if (expected) {
        return true;
    }

    if (!resolved) {
        optionalModules++;
    }

    return Boolean(resolved);
}) : imports;
const source = installedImports.map((item, index) => 'import type {' + item.name + ' as DocImport' + index + '} from ' + JSON.stringify(item.module) + '; // ' + item.file).join('\n');
const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: ['node'],
};
const host = ts.createCompilerHost(options);
const originalRead = host.readFile.bind(host);
const originalExists = host.fileExists.bind(host);

host.readFile = file => path.resolve(file) === filename ? source : originalRead(file);
host.fileExists = file => path.resolve(file) === filename || originalExists(file);

const program = ts.createProgram([filename], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length) {
    for (const diagnostic of diagnostics) {
        const line = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line;
        const item = diagnostic.file?.fileName === filename && line !== undefined ? installedImports[line] : undefined;

        console.error((item ? item.file + ': ' : '') + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }

    process.exitCode = 1;
} else {
    if (optionalModules) {
        console.log('Optional integration imports not installed: ' + optionalModules + '. Use --consumer <installed-consumer-directory> for the complete cross-application check.');
    }

    console.log('Validated ' + installedImports.length + ' documented named imports across ' + files.length + ' Markdown files against installed declarations.');
}
