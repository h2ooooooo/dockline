import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {javascript, commonJs, unformattedTechnicalText} from './docs-example-utils.mjs';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'example-variants.json')));
const labels = ['TypeScript', 'JavaScript', 'MJS', 'CommonJS'];
const extensions = ['ts', 'js', 'mjs', 'cjs'];
const errors = [];
const examples = [];
const pages = [];
const check = (condition, message) => {
    if (!condition) {
        errors.push(message);
    }
};

function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        if (entry.name.startsWith('.') || ['public', 'node_modules'].includes(entry.name)) {
            continue;
        }

        const filename = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            walk(filename);
        } else if (filename.endsWith('.md')) {
            pages.push(filename);
        }
    }
}

walk(root);

for (const filename of pages) {
    const relative = path.relative(root, filename).replaceAll('\\', '/');
    const text = fs.readFileSync(filename, 'utf8');

    check(unformattedTechnicalText(text).length === 0, relative + ': unformatted technical text');

    check(!/your (?:own )?application|your computer/i.test(text), relative + ': forbidden terminology');
    check(!/--path\.|\.(?:mjs|cjs|js|ts)\.\//.test(text), relative + ': malformed command');
    check(!/Save this as `[^`]+\.mjs`/.test(text), relative + ': MJS-first instructions');
    check(!/@(?:h2ooooooo)\//.test(text), relative + ': incorrect npm scope');
    check(!/https:\/\/(?:www\.)?npmjs\.com\/package\/[^\s)]+\/v\//.test(text), relative + ': versioned ecosystem link');

    for (const [index, match] of [...text.matchAll(/::: code-group\n([\s\S]*?)\n:::/g)].entries()) {
        const blocks = [...match[1].matchAll(/```(\w+) \[([^\]]+)\]\n([\s\S]*?)```/g)];

        if (!blocks.some(block => labels.includes(block[2]))) {
            continue;
        }

        check(JSON.stringify(blocks.map(block => block[2])) === JSON.stringify(labels), relative + '#' + index + ': tab order/coverage');

        const source = blocks[0][3].trim();
        const program = manifest.programs.find(item => item.page === relative && source.startsWith('// ' + item.name + '.ts\n'));
        const shell = blocks[0][1] === 'sh';

        examples.push({
            page: relative,
            group: index,
            kind: shell ? 'run-commands' : program ? 'complete-program' : 'contextual-recipe',
            program: program?.name,
        });

        if (shell) {
            check(blocks[0][3].includes('npm pkg set type=module'), relative + '#' + index + ': missing TypeScript ESM setup');
            continue;
        }

        const esm = javascript(source);
        const complete = /async function main\(\)/.test(blocks[3]?.[3] ?? '');
        const noFilename = code => code.replace(/^\/\/ [\w-]+\.(?:ts|js|mjs|cjs)\n/, '').trim();
        const expected = [source, esm, esm, commonJs(noFilename(esm), complete).trim()];

        blocks.forEach((block, languageIndex) => {
            const parsed = ts.createSourceFile('snippet.' + (languageIndex ? 'js' : 'ts'), block[3], ts.ScriptTarget.Latest, true);

            check(parsed.parseDiagnostics.length === 0, relative + '#' + index + ': ' + block[2] + ' syntax');
            check(noFilename(block[3]) === noFilename(expected[languageIndex]), relative + '#' + index + ': ' + block[2] + ' formatting differs');

            if (program) {
                const asset = path.join(root, 'public/examples', program.name + '.' + extensions[languageIndex]);

                check(noFilename(fs.readFileSync(asset, 'utf8')) === noFilename(block[3]), relative + ': download differs from ' + program.name + '.' + extensions[languageIndex]);

                const command = (languageIndex ? 'node ' : 'npx tsx ') + program.name + '.' + extensions[languageIndex] + (program.args ? ' ' + program.args : '');

                check(text.includes(command), relative + ': missing matching run command ' + command);
            }
        });
    }

    const outside = text.replace(/::: code-group\n[\s\S]*?\n:::/g, '');

    for (const _match of outside.matchAll(/```(ts|js|javascript)\b[^\n]*\n([\s\S]*?)```/g)) {
        check(relative === 'reference/types.md' || relative === 'keys/reference.md', relative + ': ungrouped executable example');
    }
}

for (const program of manifest.programs) {
    check(examples.some(example => example.kind === 'complete-program' && example.program === program.name), program.name + ': complete program not found');

    const text = fs.readFileSync(path.join(root, program.page), 'utf8');

    check(/output|prints|print nothing/i.test(text), program.page + ': output not explained');
}

const result = {
    markdownPages: pages.length,
    completePrograms: manifest.programs.length,
    runnableVariants: manifest.assets.length,
    examples,
    errors,
};

fs.mkdirSync(path.join(root, '.local-dev'), {recursive: true});
fs.writeFileSync(path.join(root, '.local-dev/docs-layout.json'), JSON.stringify(result, null, 4));
console.log(JSON.stringify({
    markdownPages: pages.length,
    completePrograms: manifest.programs.length,
    runnableVariants: manifest.assets.length,
    languageGroups: examples.length,
    errors,
}, null, 4));

if (errors.length) {
    throw new Error('Documentation consistency checks failed');
}
