import assert from 'node:assert/strict';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sections = [
    '<!-- Generated from public package declarations by scripts/generate-api-docs.mjs. -->',
    '# TypeScript reference',
    '',
    'These signatures come from the public package entry points and their re-exports. Build the libraries and run `npm run docs:api` to update them. Use the API guide for behavior and examples.',
    '',
];

for (const directory of (await readdir(path.join(repository, 'packages'))).sort()) {
    const root = path.join(repository, 'packages', directory);
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

    if (!manifest.types) {
        continue;
    }

    const entry = path.resolve(root, manifest.types);
    const visited = new Set();
    const declarations = [];

    async function visit(file) {
        if (visited.has(file)) {
            return;
        }

        assert.ok(file.startsWith(path.join(root, 'dist') + path.sep), 'Declarations must remain inside the built package');
        visited.add(file);

        const text = await readFile(file, 'utf8');

        declarations.push({filename: path.basename(file), text: text.replace(/\r\n/g, '\n').replace(/\n\/\/# sourceMappingURL=[^\n]+/g, '').trim()});

        for (const match of text.matchAll(/export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]\.\/([^'"]+)['"]/g)) {
            const relative = match[1].replace(/\.js$/, '');

            await visit(path.join(path.dirname(file), relative + '.d.ts'));
        }
    }

    await visit(entry);
    sections.push('## ' + manifest.name, '');

    for (const declaration of declarations) {
        sections.push('### ' + declaration.filename, '', '```ts', declaration.text, '```', '');
    }
}

const result = sections.join('\n').trimEnd() + '\n';
const filename = path.join(repository, 'docs/reference/types.md');

if (process.argv.includes('--check')) {
    assert.equal(await readFile(filename, 'utf8'), result, 'API documentation drifted; run npm run docs:api after building');
    console.log('Public API declaration reference matches the built packages.');
} else {
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(filename, result);
    console.log('Generated the public API declaration reference.');
}
