import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 30000,
        hookTimeout: 30000,
        include: ['packages/*/tests/**/*.test.ts'],
        // Native loading preserves package identity with the SDK's optional-client loader.
        server: {
            deps: {
                external: [
                    /^@dockline\/(?:abstract|core|ftp-client|sftp-client)(?:\/|$)/,
                    /[/\\]packages[/\\](?:abstract|core|ftp-client|sftp-client)[/\\]dist[/\\]/,
                ],
            },
        },
    },
});
