import type {DefaultTheme} from 'vitepress';

export const nav: DefaultTheme.NavItem[] = [
    {text: 'Overview', link: '/'},
    {text: 'API', link: '/api/', activeMatch: '^/(api|guide|ftp|sftp|ssh|reference|development|spec)/'},
    {text: 'CLI', link: '/cli/', activeMatch: '^/cli/'},
    {text: 'Keys', link: '/keys/', activeMatch: '^/keys/'},
];

const api: DefaultTheme.SidebarItem[] = [
    {
        text: 'Get started',
        items: [
            {text: 'API overview', link: '/api/'},
            {text: 'Install and choose packages', link: '/guide/installation'},
            {text: 'Connect and list your server', link: '/api/quick-start'},
            {text: 'Try a local server instead', link: '/api/local-demo'},
            {text: 'Connect saved application profiles', link: '/guide/saved-profiles'},
            {text: 'Example languages and modules', link: '/guide/code-examples'},
        ],
    },
    {
        text: 'Do more',
        items: [
            {text: 'Upload, download and manage files', link: '/api/files'},
            {text: 'FTP and FTPS', link: '/ftp/quick-start'},
            {text: 'SFTP transfers', link: '/sftp/quick-start'},
            {text: 'SSH commands', link: '/ssh/quick-start'},
            {text: 'SSH options and grouped challenges', link: '/ssh/configuration'},
        ],
    },
    {
        text: 'Authentication and trust',
        collapsed: true,
        items: [
            {text: 'Passwords, private keys and agents', link: '/guide/sftp'},
            {text: 'Host trust and known hosts', link: '/guide/trust'},
            {text: 'FTP and TLS settings', link: '/guide/ftp'},
        ],
    },
    {
        text: 'Advanced usage',
        collapsed: true,
        items: [
            {text: 'Configuration and defaults', link: '/guide/configuration'},
            {text: 'Sessions and streams', link: '/guide/usage'},
            {text: 'Publication, progress and traversal', link: '/guide/advanced-transfers'},
            {text: 'Connection pools', link: '/guide/pools'},
            {text: 'Errors and recovery', link: '/guide/errors'},
        ],
    },
    {
        text: 'Reference',
        collapsed: true,
        items: [
            {text: 'Packages and architecture', link: '/guide/packages'},
            {text: 'Methods and options', link: '/reference/api'},
            {text: 'Exact TypeScript signatures', link: '/reference/types'},
            {text: 'Embed the CLI runner', link: '/guide/cli-integration'},
        ],
    },
    {
        text: 'Contributing',
        collapsed: true,
        items: [
            {text: 'Build from source', link: '/development/compiler'},
            {text: 'Architecture specification', link: '/spec/architecture'},
            {text: 'Dependencies and boundaries', link: '/development/dependencies'},
            {text: 'Tests and local fixtures', link: '/development/testing'},
        ],
    },
];

const cli: DefaultTheme.SidebarItem[] = [
    {
        text: 'Get started',
        items: [
            {text: 'CLI overview', link: '/cli/'},
            {text: 'Install and transfer a file', link: '/cli/quick-start'},
            {text: 'Try a local server instead', link: '/guide/local-demo'},
        ],
    },
    {
        text: 'Commands',
        items: [
            {text: 'upload', link: '/cli/upload'},
            {text: 'download', link: '/cli/download'},
            {text: 'list', link: '/cli/list'},
            {text: 'remove', link: '/cli/remove'},
        ],
    },
    {
        text: 'Configure and automate',
        collapsed: true,
        items: [
            {text: 'Connection settings and YAML', link: '/cli/configuration'},
            {text: 'Human output, JSON and exit codes', link: '/cli/output'},
            {text: 'Shell scripts', link: '/cli/scripting'},
            {text: 'Troubleshooting', link: '/cli/troubleshooting'},
        ],
    },
    {
        text: 'Reference',
        collapsed: true,
        items: [
            {text: 'Every command and option', link: '/cli/help'},
            {text: 'Command defaults and behavior', link: '/cli/commands'},
        ],
    },
];

const keys: DefaultTheme.SidebarItem[] = [
    {
        text: 'Dockline Keys',
        items: [
            {text: 'Overview and installation', link: '/keys/'},
            {text: 'Quick start', link: '/keys/quick-start'},
        ],
    },
    {
        text: 'Work with keys',
        items: [
            {text: 'Inspect and fingerprint', link: '/keys/inspect'},
            {text: 'Convert private keys', link: '/keys/convert'},
            {text: 'Encryption and passphrases', link: '/keys/encryption'},
            {text: 'Extract and convert public keys', link: '/keys/public-keys'},
            {text: 'Read and save files', link: '/keys/files'},
        ],
    },
    {
        text: 'Reference',
        collapsed: true,
        items: [
            {text: 'Formats and algorithms', link: '/keys/formats'},
            {text: 'API, errors and limits', link: '/keys/reference'},
            {text: 'Example languages and modules', link: '/guide/code-examples'},
        ],
    },
];

export const sidebar: DefaultTheme.Sidebar = {
    '/keys/': keys,
    '/guide/keys': keys,
    '/cli/': cli,
    '/guide/local-demo': cli,
    '/guide/cli-integration': api,
    '/guide/cli': cli,
    '/': api,
};
