import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = execFileSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
});
const files = [...new Set(output.split('\0').filter(Boolean))];
const publicKeys = new Set([
    'packages/ftp-client/tests/fixtures/localhost-test-key.pem',
    'packages/sftp-client/tests/fixtures/public-test-ed25519-key.pem',
    'packages/sftp-client/tests/fixtures/ppk/dsa_v3.ppk',
    'packages/sftp-client/tests/fixtures/ppk/rsa-reference.openssh',
    'packages/sftp-client/tests/fixtures/ppk/test_ecdsa_nistp256_puttygen_v3.ppk',
    'packages/sftp-client/tests/fixtures/ppk/test_ecdsa_nistp384_2_puttygen_v3.ppk',
    'packages/sftp-client/tests/fixtures/ppk/test_ecdsa_nistp521_2_puttygen_v3.ppk',
    'packages/sftp-client/tests/fixtures/ppk/test_ed25519_puttygen_v3.ppk',
    'packages/sftp-client/tests/fixtures/ppk/v3_ecdsa.ppk',
    'packages/sftp-client/tests/fixtures/ppk/v3_rsa_argon2d.ppk',
    'packages/sftp-client/tests/fixtures/ppk/v3_rsa_argon2i.ppk',
    'packages/sftp-client/tests/fixtures/ppk/v3_rsa_argon2id.ppk',
]);
const excluded = /(^|\/)(node_modules|dist|coverage|\.git|\.idea|\.vscode|\.scratch|\.serena|cache)(\/|$)/;
const localSettings = /(^|\/)(\.npmrc|\.env(?:\..+)?|dockline\.server\.ya?ml|known-hosts\.json(?:\.lock)?)$/;
const credentials = /(?:gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}/;

for (const filename of files) {
    assert.ok(!excluded.test(filename), `Generated or local file included: ${filename}`);
    assert.ok(!localSettings.test(filename) || filename.endsWith('.env.example'), `Local settings included: ${filename}`);
    assert.ok(!/\.(tgz|log|tsbuildinfo)$/.test(filename), `Generated artifact included: ${filename}`);

    const contents = await readFile(path.join(root, filename));

    assert.ok(contents.length <= 2 * 1024 * 1024, `Review unexpectedly large repository file: ${filename}`);

    if (contents.includes(0)) {
        continue;
    }

    const text = contents.toString('utf8');

    assert.ok(!credentials.test(text), `Potential credential found in ${filename}`);

    // Match key material, not an encoder's literal PEM header string.
    const pemKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*(?:\r?\n|\\n)(?:(?:Proc-Type|DEK-Info):[^\r\n]*(?:\r?\n|\\n)\s*)*[A-Za-z0-9+/]{24,}/.test(text);
    const puttyKey = /^PuTTY-User-Key-File-[23]: /m.test(text);

    if (pemKey || puttyKey) {
        assert.ok(publicKeys.has(filename), `Undocumented private key included: ${filename}`);

        const notice = await readFile(path.join(root, path.dirname(filename), 'README.md'), 'utf8');

        assert.match(notice, /public test/i, `Test identity must be documented: ${filename}`);
    }
}

console.log(`Repository contents checked: ${files.length} files; generated output and local credentials excluded.`);
