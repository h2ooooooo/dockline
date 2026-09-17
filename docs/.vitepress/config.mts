import {defineConfig} from 'vitepress';

const githubPages = process.env.DOCKLINE_GITHUB_PAGES === 'true';

export default defineConfig({
    title: 'Dockline',
    description: 'One transfer API for FTP, FTPS and SFTP, with controls for demanding applications.',
    lang: 'en-US',
    base: process.env.DOCKLINE_DOCS_BASE ?? '/',
    appearance: false,
    cleanUrls: !githubPages,
    lastUpdated: true,
    markdown: {theme: 'github-dark'},
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
        nav: [
            {text: 'FTP', link: '/ftp/quick-start'},
            {text: 'SFTP', link: '/sftp/quick-start'},
            {text: 'CLI', link: '/guide/cli'},
            {text: 'Packages', link: '/guide/packages'},
            {text: 'API', link: '/reference/api'},
            {text: 'Specification', link: '/spec/architecture'},
        ],
        sidebar: [
            {text: 'SSH', items: [{text: 'Commands and transfers', link: '/ssh/quick-start'}]},
            {
                text: 'Start here',
                items: [
                    {text: 'Installation', link: '/guide/installation'},
                    {text: 'Packages and layout', link: '/guide/packages'},
                    {text: 'Choose your quick start', link: '/guide/quick-start'},
                ],
            },
            {
                text: 'FTP',
                items: [
                    {text: 'Quick start FTP', link: '/ftp/quick-start'},
                    {text: 'Connection settings and FTPS', link: '/guide/ftp'},
                ],
            },
            {
                text: 'SFTP',
                items: [
                    {text: 'Quick start SFTP', link: '/sftp/quick-start'},
                    {text: 'Connection settings and authentication', link: '/guide/sftp'},
                    {text: 'Host trust and known hosts', link: '/guide/trust'},
                ],
            },
            {
                text: 'CLI',
                items: [
                    {text: 'Quick start and installation', link: '/guide/cli'},
                    {text: 'Commands', link: '/cli/commands'},
                    {text: 'YAML configuration', link: '/cli/configuration'},
                    {text: 'Embedding and SDK integration', link: '/guide/cli-integration'},
                ],
            },
            {
                text: 'Shared guides',
                items: [
                    {text: 'Configuration and defaults', link: '/guide/configuration'},
                    {text: 'Everyday usage', link: '/guide/usage'},
                    {text: 'Use in your CLI', link: '/guide/cli-integration'},
                    {text: 'Connection pools', link: '/guide/pools'},
                    {text: 'Advanced transfers', link: '/guide/advanced-transfers'},
                    {text: 'Errors and recovery', link: '/guide/errors'},
                ],
            },
            {
                text: 'Reference and development',
                items: [
                    {text: 'Public API', link: '/reference/api'},
                    {text: 'Architecture and specification', link: '/spec/architecture'},
                    {text: 'Compiler and packages', link: '/development/compiler'},
                    {text: 'Dependencies and limitations', link: '/development/dependencies'},
                    {text: 'Testing and documentation', link: '/development/testing'},
                    {text: 'Updates and releases', link: '/development/releasing'},
                ],
            },
        ],
        editLink: {
            pattern: 'https://github.com/h2ooooooo/dockline/blob/main/docs/:path',
            text: 'View this page on GitHub',
        },
        socialLinks: [{icon: 'github', link: 'https://github.com/h2ooooooo/dockline'}],
        search: {provider: 'local'},
        outline: {level: [2, 3]},
        footer: {message: 'Files, across protocols.', copyright: 'Dockline contributors'},
    },
});
