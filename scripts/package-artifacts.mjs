import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';

/** Explicit development artifacts, never consulted by runtime libraries. */
export async function artifactPackages(directory) {
    const root = await realpath(path.resolve(directory));
    const packages = new Map();

    for (const filename of (await readdir(root)).filter(name => name.endsWith('.packages.json')).sort()) {
        const entries = JSON.parse(await readFile(path.join(root, filename), 'utf8'));

        assert.ok(Array.isArray(entries), 'Artifact inventory must be an array');

        for (const item of entries) {
            assert.match(item.name, /^@[a-z0-9-]+\/[a-z0-9-]+$/);
            assert.equal(path.basename(item.filename), item.filename, 'Tarball filename must not contain a path');
            assert.ok(item.filename.endsWith('.tgz'));

            const file = await realpath(path.join(root, item.filename));

            assert.equal(path.dirname(file), root, 'Tarballs must remain inside the selected directory');
            assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
            assert.equal('sha512-' + createHash('sha512').update(await readFile(file)).digest('base64'), item.integrity,
                item.name + ': tarball integrity mismatch');

            if (packages.has(item.name)) {
                assert.equal(packages.get(item.name).integrity, item.integrity, 'Conflicting artifact inventories');
            }

            packages.set(item.name, {...item, file});
        }
    }

    assert.ok(packages.size > 0, 'No package inventories found; run pack:local first');

    return [...packages.values()];
}

export function argument(name) {
    const position = process.argv.indexOf(name);

    if (position < 0 || !process.argv[position + 1] || process.argv[position + 1].startsWith('--')) {
        throw new Error('Required argument: ' + name + ' <directory>');
    }

    return process.argv[position + 1];
}
