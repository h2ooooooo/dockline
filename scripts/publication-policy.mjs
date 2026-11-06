import assert from 'node:assert/strict';

const localDocumentationScratch = new Set([
    'docs/.test-connect.mjs',
    'docs/.test-inspect.mjs',
]);

/** Git ignores do not protect files that have been force-added to the source inventory. */
export function assertNoLocalDocumentationScratch(filename) {
    const normalized = filename.replaceAll('\\', '/').toLowerCase();

    assert.ok(!localDocumentationScratch.has(normalized), 'Local documentation scratch file included: ' + filename);
}
