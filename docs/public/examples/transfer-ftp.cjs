const {Dockline} = require('@jalsoedesign/dockline-core');

async function main() {
    function requiredEnv(name) {
        const value = process.env[name];

        if (!value) {
            throw new Error(`Set ${name} before running this example`);
        }

        return value;
    }

    const connection                    = {
        protocol: 'ftp',
        host: requiredEnv('FTP_HOST'),
        username: requiredEnv('FTP_USERNAME'),
        password: requiredEnv('FTP_PASSWORD'),
        root: process.env.FTP_ROOT ?? '',
    };

    const remote = await Dockline.connect(connection);

    try {
        // Upload local file './hello.txt' to 'dockline-example.txt' on the server.
        await remote.uploadFile('./hello.txt', 'dockline-example.txt');

        // Download 'dockline-example.txt' from the server
        // to './dockline-downloaded.txt' on the host.
        await remote.downloadFile('dockline-example.txt', './dockline-downloaded.txt', {
            overwrite: 'replace',
        });

        console.log('Uploaded hello.txt and downloaded a copy into the working directory.');
    } finally {
        await remote.disconnect();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
