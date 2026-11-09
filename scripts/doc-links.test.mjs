import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {auditBuiltDocs, installBaseLinks, rebaseHtmlUrls} from './doc-links.mjs';

test('raw downloads keep the deployed project prefix without changing external links', () => {
    const html = '<a href="/examples/code.cjs" download="code.cjs">CJS</a><img src="/logo.svg"><a href="https://example.test/">External</a>';

    assert.equal(rebaseHtmlUrls(html, '/sample/'), '<a href="/sample/examples/code.cjs" download="code.cjs">CJS</a><img src="/sample/logo.svg"><a href="https://example.test/">External</a>');
    assert.equal(rebaseHtmlUrls(html, '/'), html);
    assert.equal(rebaseHtmlUrls('<a href="/sample/examples/code.cjs">CJS</a>', '/sample/'), '<a href="/sample/examples/code.cjs">CJS</a>');
});

test('HTML rendering applies the prefix and preserves the original token', () => {
    const markdown = {renderer: {rules: {html_inline: (tokens, index) => tokens[index].content}}};
    const tokens = [{content: '<a href="/examples/code.cjs" download>'}];

    installBaseLinks(markdown, '/sample/');
    assert.equal(markdown.renderer.rules.html_inline(tokens, 0), '<a href="/sample/examples/code.cjs" download>');
    assert.equal(tokens[0].content, '<a href="/examples/code.cjs" download>');
});

test('published-output audit rejects escaping URLs, missing files and missing anchors', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'docs-link-regression-'));

    try {
        await mkdir(path.join(directory, 'examples'));
        await writeFile(path.join(directory, 'examples/code.cjs'), 'module.exports = {};');
        await writeFile(path.join(directory, 'guide.html'), '<h1 id="usage">Usage</h1>');
        await writeFile(path.join(directory, 'index.html'), '<a href="/examples/code.cjs" download>CJS</a>');
        await assert.rejects(auditBuiltDocs(directory, '/sample/', 'sample'), /escapes documentation base/);
        await writeFile(path.join(directory, 'index.html'), '<a href="/sample/examples/code.cjs" download>CJS</a><a href="/sample/guide.html#usage">Guide</a>');
        assert.deepEqual(await auditBuiltDocs(directory, '/sample/', 'sample'), {pages: 2, links: 2});
        await writeFile(path.join(directory, 'index.html'), '<a href="/sample/guide.md">Missing download</a>');
        await assert.rejects(auditBuiltDocs(directory, '/sample/', 'sample'), /missing.*guide.md/);
        await writeFile(path.join(directory, 'index.html'), '<a href="/sample/guide.html#missing">Missing anchor</a>');
        await assert.rejects(auditBuiltDocs(directory, '/sample/', 'sample'), /missing anchor/);
        await writeFile(path.join(directory, 'index.html'), '<p>This guide is now in another section.</p>');
        await assert.rejects(auditBuiltDocs(directory, '/sample/', 'sample'), /moved-notice stub/);
    } finally {
        assert.equal(path.dirname(directory), tmpdir());
        assert.ok(path.basename(directory).startsWith('docs-link-regression-'));
        await rm(directory, {recursive: true, force: true});
    }
});
