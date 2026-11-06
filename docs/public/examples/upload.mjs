import {Dockline} from '@jalsoedesign/dockline-core';

const [localPath, remotePath] = process.argv.slice(2);
const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

if (!localPath || !remotePath || !SFTP_HOST || !SFTP_USERNAME || !SFTP_SHA256) {
    throw new Error('Supply local/remote paths and SFTP_HOST, SFTP_USERNAME, SFTP_SHA256');
}

const controller = new AbortController();
const cancel = () => controller.abort();

process.once('SIGINT', cancel);

try {
    await Dockline.withConnection({
        protocol: 'sftp',
        host: SFTP_HOST,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        abortSignal: controller.signal,
        requireTrustPolicy: true,
        hasTrustPolicy: challenge => challenge.fingerprint === SFTP_SHA256,
        acceptTrustPolicy: () => false,
    }, async remote => {
        // Upload local file localPath to remotePath on the server.
        await remote.uploadFile(localPath, remotePath);
    });
} finally {
    process.removeListener('SIGINT', cancel);
}
