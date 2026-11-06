import {Dockline} from '@jalsoedesign/dockline-core';

const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
    throw new Error('Set SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD and SFTP_SHA256.');
}

const connection = {
    protocol: 'sftp',
    host: SFTP_HOST,
    username: SFTP_USERNAME,
    password: SFTP_PASSWORD,
    requireTrustPolicy: true,
    hasTrustPolicy: challenge => (
        challenge.host === SFTP_HOST &&
        challenge.port === 22 &&
        challenge.fingerprint === SFTP_SHA256
    ),
    acceptTrustPolicy: () => false,
};

await Dockline.withConnection(connection, async remote => {
    for await (const entry of remote.list('.')) {
        console.log(entry.path, entry.type);
    }

    console.log('Directory listed.');
});

console.log('Connection closed.');
