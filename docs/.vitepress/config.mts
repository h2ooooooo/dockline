import {defineConfig} from 'vitepress';
import {auditBuiltDocs, installBaseLinks} from '../../scripts/doc-links.mjs';
import {nav, sidebar} from './navigation.mjs';

const githubPages = process.env.DOCKLINE_GITHUB_PAGES === 'true';

const docsBase = process.env.DOCKLINE_DOCS_BASE ?? process.env.DOCS_BASE ?? '/';

export default defineConfig({
    title: 'Dockline',
    description: 'FTP, FTPS and SFTP transfers, SSH commands and key utilities, with optional shared saved-profile integration.',
    lang: 'en-US',
    base: docsBase,
    appearance: false,
    cleanUrls: !githubPages,
    lastUpdated: false,
    markdown: {
        theme: 'github-dark-high-contrast',
        config(markdown) {
            installBaseLinks(markdown, docsBase);
        },
    },
    async buildEnd(site) {
        const result = await auditBuiltDocs(site.outDir, site.site.base, 'dockline');

        console.log(`Documentation links verified: ${result.pages} pages, ${result.links} links.`);
    },
    head: [['meta', {name: 'theme-color', content: '#171a1d'}]],
    vite: {
        css: {
            preprocessorOptions: {
                scss: {api: 'modern'},
            },
        },
    },
    themeConfig: {
        siteTitle: 'Dockline',
        nav: nav,
        sidebar: sidebar,
        editLink: {
            pattern: 'https://github.com/h2ooooooo/dockline/blob/main/docs/:path',
            text: 'View this page on GitHub',
        },
        socialLinks: [{icon: 'github', link: 'https://github.com/h2ooooooo/dockline'}],
        search: {provider: 'local'},
        outline: {level: [2, 3]},
    },
});
