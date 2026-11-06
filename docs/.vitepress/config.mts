import {defineConfig} from 'vitepress';
import {nav, sidebar} from './navigation.mjs';

const githubPages = process.env.DOCKLINE_GITHUB_PAGES === 'true';

export default defineConfig({
    title: 'Dockline',
    description: 'One transfer API for FTP, FTPS and SFTP, with controls for demanding applications.',
    lang: 'en-US',
    base: process.env.DOCKLINE_DOCS_BASE ?? '/',
    appearance: false,
    cleanUrls: !githubPages,
    lastUpdated: false,
    markdown: {theme: 'github-dark-high-contrast'},
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
