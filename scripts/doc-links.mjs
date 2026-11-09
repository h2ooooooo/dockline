import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {URL} from 'node:url';

export function rebaseHtmlUrls(html, base) {
    if (base === '/') {
        return html;
    }

    assert.ok(base.startsWith('/') && base.endsWith('/'), 'Documentation base must start and end with /');

    return html.replace(/(?<![\w:-])(href|src)\s*=\s*(["'])(\/(?!\/).*?)\2/gi, (match, attribute, quote, value) => {
        const target = value.startsWith(base) ? value : base + value.slice(1);

        return `${attribute}=${quote}${target}${quote}`;
    });
}

export function installBaseLinks(markdown, base) {
    for (const name of ['html_inline', 'html_block']) {
        const previous = markdown.renderer.rules[name];

        markdown.renderer.rules[name] = (tokens, index, options, environment, renderer) => {
            const original = tokens[index].content;

            tokens[index].content = rebaseHtmlUrls(original, base);

            try {
                return previous ? previous(tokens, index, options, environment, renderer) : tokens[index].content;
            } finally {
                tokens[index].content = original;
            }
        };
    }
}

export async function auditBuiltDocs(directory, base, repository) {
    const root = path.resolve(directory);
    const pages = new Map();
    const broken = new Set();
    let links = 0;

    async function visit(folder) {
        for (const entry of await readdir(folder, {withFileTypes: true})) {
            const filename = path.join(folder, entry.name);

            if (entry.isDirectory()) {
                await visit(filename);
            } else if (entry.isFile() && filename.endsWith('.html')) {
                pages.set(filename, await readFile(filename, 'utf8'));
            }
        }
    }

    await visit(root);
    assert.ok(pages.size, 'No rendered documentation pages found');

    for (const [filename, html] of pages) {
        const relative = path.relative(root, filename).split(path.sep).join('/');

        if (/This guide is now in|Find the moved section/.test(html)) {
            broken.add(`${relative}: moved-notice stub must display the actual guide`);
        }

        const pageUrl = new URL(base + relative, 'https://documentation.invalid');

        for (const match of html.matchAll(/(?<![\w:-])(?:href|src)=["']([^"'<>]+)["']/gi)) {
            const href = match[1].replaceAll('&amp;', '&');

            if (/^(?:mailto:|tel:|data:|javascript:)/i.test(href)) {
                continue;
            }

            const url = new URL(href, pageUrl);
            let pathname;

            if (url.hostname === 'documentation.invalid') {
                if (!url.pathname.startsWith(base)) {
                    broken.add(`${relative}: ${href} escapes documentation base ${base}`);
                    continue;
                }

                pathname = url.pathname.slice(base.length);
            } else if (url.hostname === 'h2ooooooo.github.io' && url.pathname.startsWith('/' + repository + '/')) {
                pathname = url.pathname.slice(repository.length + 2);
            } else {
                continue;
            }

            links++;

            const target = path.resolve(root, decodeURIComponent(pathname));

            if (target !== root && !target.startsWith(root + path.sep)) {
                broken.add(`${relative}: ${href} leaves documentation output`);
                continue;
            }

            const candidates = url.pathname.endsWith('/') ? [path.join(target, 'index.html')] : [target];

            if (!path.extname(target)) {
                candidates.push(target + '.html', path.join(target, 'index.html'));
            }

            let found;

            for (const candidate of candidates) {
                if ((await stat(candidate).catch(() => undefined))?.isFile()) {
                    found = candidate;
                    break;
                }
            }

            if (!found) {
                broken.add(`${relative}: missing ${href}`);
                continue;
            }

            if (url.hash && pages.has(found) && !url.hash.startsWith('#:~:text=')) {
                const id = decodeURIComponent(url.hash.slice(1));
                const ids = new Set([...pages.get(found).matchAll(/\bid=["']([^"']+)["']/g)].map(item => item[1]));

                if (!ids.has(id)) {
                    broken.add(`${relative}: missing anchor ${href}`);
                }
            }
        }
    }

    assert.equal(broken.size, 0, 'Broken published documentation links:\n' + [...broken].join('\n'));

    return {pages: pages.size, links};
}
