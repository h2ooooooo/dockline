const {SshClient} = require('@jalsoedesign/dockline-ssh-client');

async function main() {
    const {SFTP_HOST, SFTP_USERNAME, SFTP_PASSWORD, SFTP_SHA256} = process.env;

    if (!SFTP_HOST || !SFTP_USERNAME || !SFTP_PASSWORD || !SFTP_SHA256) {
        throw new Error('Set the four connection variables first.');
    }

    const client = new SshClient({
        host: SFTP_HOST,
        port: 22,
        username: SFTP_USERNAME,
        password: SFTP_PASSWORD,
        hostFingerprint: SFTP_SHA256,
        readyTimeout: 30000,
    });

    await client.withConnection(async session => {
        const result = await session.exec('whoami');

        process.stdout.write(result.stdout);
        console.log('Exit code:', result.code);
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
