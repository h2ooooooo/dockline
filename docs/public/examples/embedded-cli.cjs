const {runCli} = require('@jalsoedesign/dockline-cli');

async function main() {
    // Download server source hello.txt to host destination ./downloaded-hello.txt.
    const exitCode = await runCli([
        'download',
        '--source-file',
        'hello.txt',
        '--destination-file',
        './downloaded-hello.txt',
        '--config',
        'dockline.server.yml',
    ], {
        cwd: process.cwd(),
        env: process.env,
        stdout: process.stdout,
        stderr: process.stderr,
    });

    process.exitCode = exitCode;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
