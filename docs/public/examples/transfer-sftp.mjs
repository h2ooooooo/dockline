import {Dockline} from '@jalsoedesign/dockline-core';

function requiredEnv(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Set ${name} before running this example`);
    }

    return value;
}

const host = requiredEnv('SFTP_HOST');
const fingerprint = requiredEnv('SFTP_SHA256');
const port = 22;
const connection                     = {
    protocol: 'sftp',
    host,
    port,
    username: requiredEnv('SFTP_USERNAME'),
    password: requiredEnv('SFTP_PASSWORD'),
    root: process.env.SFTP_ROOT ?? '',
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === host &&
        challenge.port === port &&
        challenge.fingerprint === fingerprint
    ),
    acceptTrustPolicy: () => false,
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
