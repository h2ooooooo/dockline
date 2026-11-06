import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {URL} from 'node:url';
import {artifactPackages} from './package-artifacts.mjs';

/** Verified local release artifacts, exposed only by an explicit read-only bootstrap registry. */
export async function releaseCandidates(directory) {
    const candidates = new Map();

    for (const artifact of await artifactPackages(directory)) {
        const result = spawnSync('tar', ['-xOf', artifact.file, 'package/package.json'], {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        });

        assert.equal(result.status, 0, 'Reading release metadata requires the tar command');

        const manifest = JSON.parse(result.stdout);

        assert.equal(manifest.name, artifact.name, 'Artifact name differs from its package manifest');
        assert.equal(manifest.version, artifact.version, 'Artifact version differs from its package manifest');

        const filename = artifact.name.split('/')[1] + '-' + artifact.version + '.tgz';
        const pathname = '/' + artifact.name + '/-/' + filename;

        candidates.set(artifact.name, {
            ...artifact,
            manifest,
            pathname,
            tarball: 'https://registry.npmjs.org' + pathname,
        });
    }

    return candidates;
}

export async function startReleaseRegistry(directory, canonical = false) {
    const candidates = await releaseCandidates(directory);
    const tarballs = new Map([...candidates.values()].map(candidate => [candidate.pathname, candidate]));
    const server = createServer(async (request, response) => {
        try {
            if (!['GET', 'HEAD'].includes(request.method ?? '')) {
                response.writeHead(405).end('This bootstrap registry is read-only');

                return;
            }

            const url = new URL(request.url ?? '/', 'http://127.0.0.1');
            const pathname = decodeURIComponent(url.pathname);
            const tarball = tarballs.get(pathname);

            response.setHeader('Cache-Control', 'no-store');

            if (tarball) {
                response.setHeader('Content-Type', 'application/octet-stream');

                if (request.method === 'HEAD') {
                    response.end();
                } else {
                    createReadStream(tarball.file).pipe(response);
                }

                return;
            }

            const candidate = candidates.get(pathname.slice(1));

            if (candidate) {
                const manifest = {
                    ...candidate.manifest,
                    dist: {
                        tarball: canonical ? candidate.tarball : 'http://127.0.0.1:' + server.address().port + candidate.pathname,
                        integrity: candidate.integrity,
                    },
                };

                response.setHeader('Content-Type', 'application/json');
                response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
                    name: candidate.name,
                    'dist-tags': {latest: candidate.version},
                    versions: {[candidate.version]: manifest},
                }));

                return;
            }

            // Only public npm reads are proxied. Client credentials and request headers are never forwarded.
            const upstream = await globalThis.fetch('https://registry.npmjs.org' + url.pathname + url.search, {
                signal: globalThis.AbortSignal.timeout(60000),
            });

            response.writeHead(upstream.status, {'Content-Type': upstream.headers.get('content-type') ?? 'application/json'});

            if (request.method === 'HEAD' || !upstream.body) {
                response.end();
            } else {
                Readable.fromWeb(upstream.body).pipe(response);
            }
        } catch {
            if (!response.headersSent) {
                response.writeHead(502);
            }

            response.end('Bootstrap registry read failed');
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    assert.ok(address && typeof address !== 'string');

    return {
        candidates,
        url: 'http://127.0.0.1:' + address.port + '/',
        async close() {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
    };
}
