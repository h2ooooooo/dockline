import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertNoLocalDocumentationScratch} from './publication-policy.mjs';

test('publication rejects local documentation scripts supplied by a force-added Git inventory', () => {
    for (const filename of [
        'docs/.test-connect.mjs',
        'docs/.test-inspect.mjs',
        'docs\\.test-connect.mjs',
        'docs\\.test-inspect.mjs',
        'DOCS/.TEST-CONNECT.MJS',
        'DOCS/.TEST-INSPECT.MJS',
    ]) {
        assert.throws(() => assertNoLocalDocumentationScratch(filename), /Local documentation scratch file included/);
    }
});

test('authored documentation and public runnable examples remain eligible', () => {
    for (const filename of [
        'docs/api/quick-start.md',
        'docs/keys/index.md',
        'examples/test-sftp.mjs',
        'examples/test-keys.mjs',
    ]) {
        assert.doesNotThrow(() => assertNoLocalDocumentationScratch(filename));
    }
});
