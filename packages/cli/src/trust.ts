import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {HostTrustError, checkAbort, type SftpHostKeyChallenge, type SftpTransferConfig} from '@jalsoedesign/dockline-core';
import type {CliTrustConfig} from './config.js';
import type {ResolvedCliContext} from './context.js';
import {terminalText} from './errors.js';

interface TrustStore {
    inspect(challenge: SftpHostKeyChallenge): Promise<{
        status: 'unknown' | 'match' | 'changed';
        previousFingerprint: string | null;
    }>;
    recordAccepted(challenge: SftpHostKeyChallenge, approval: {
        approved: true;
        previousFingerprint: string | null;
    }): Promise<void>;
}

interface TrustStoreModule {
    KnownHostsStore: {open(options: {file: string}): Promise<TrustStore>};
}

export function createCliTrust(
    connection: SftpTransferConfig,
    trust: CliTrustConfig | undefined,
    context: Pick<ResolvedCliContext, 'stdin' | 'stderr' | 'signal'>,
    json: boolean,
): Pick<SftpTransferConfig, 'requireTrustPolicy' | 'hasTrustPolicy' | 'acceptTrustPolicy'> {
    let storePromise: Promise<TrustStore> | undefined;

    function store(): Promise<TrustStore> {
        if (!storePromise) {
            // Loaded only after the core has selected the installed SFTP client.
            const module = createRequire(import.meta.url)('@jalsoedesign/dockline-sftp-client') as TrustStoreModule;
            const file = trust?.knownHostsFile ?? path.join(homedir(), '.dockline', 'known-hosts.json');

            storePromise = module.KnownHostsStore.open({file});
        }

        return storePromise;
    }

    function validateChallenge(challenge: SftpHostKeyChallenge): void {
        checkAbort(context.signal);
        checkAbort(challenge.abortSignal);

        if (
            challenge.host.toLowerCase() !== connection.host.toLowerCase() ||
            challenge.port !== (connection.port ?? 22)
        ) {
            throw new HostTrustError('The host-key challenge does not match the configured server');
        }
    }

    async function inspect(challenge: SftpHostKeyChallenge) {
        validateChallenge(challenge);

        const inspection = await (await store()).inspect(challenge);

        checkAbort(challenge.abortSignal);

        if (inspection.status === 'changed' || challenge.changed) {
            throw new HostTrustError('The remembered SFTP host key has changed. Verify the new key before updating trust');
        }

        return inspection;
    }

    function combinedChallenge(challenge: SftpHostKeyChallenge): SftpHostKeyChallenge {
        return context.signal ? {
            ...challenge,
            abortSignal: AbortSignal.any([context.signal, challenge.abortSignal]),
        } : challenge;
    }

    return {
        requireTrustPolicy: true,
        async hasTrustPolicy(challenge) {
            challenge = combinedChallenge(challenge);

            validateChallenge(challenge);

            if (trust?.fingerprint) {
                if (challenge.fingerprint !== trust.fingerprint) {
                    throw new HostTrustError('The SFTP host key does not match the configured fingerprint');
                }

                return true;
            }

            return (await inspect(challenge)).status === 'match';
        },
        async acceptTrustPolicy(challenge) {
            challenge = combinedChallenge(challenge);

            validateChallenge(challenge);

            if (trust?.fingerprint) {
                return false;
            }

            const inspection = await inspect(challenge);

            if (inspection.status === 'match') {
                return true;
            }

            if (json || !context.stdin.isTTY || !context.stderr.isTTY) {
                throw new HostTrustError('Unknown SFTP host key. Configure connection.trust.fingerprint or approve it in an interactive terminal');
            }

            if (context.stdin.destroyed || context.stdin.readableEnded) {
                throw new HostTrustError('Host approval input was closed');
            }

            const prompt = createInterface({input: context.stdin, output: context.stderr, terminal: true});
            const promptController = new AbortController();
            const signal = AbortSignal.any([challenge.abortSignal, promptController.signal]);
            let closed!: () => void;
            const inputClosed = new Promise<never>((_resolve, reject) => {
                closed = () => reject(new HostTrustError('Host approval input was closed'));
                prompt.once('close', closed);
            });

            try {
                const answer = await Promise.race([
                    prompt.question(
                        `Trust ${terminalText(challenge.host)}:${challenge.port} (${terminalText(challenge.keyType)})\n` +
                        `${terminalText(challenge.fingerprint)}\nType yes to remember this host: `,
                        {signal},
                    ),
                    inputClosed,
                ]);

                checkAbort(signal);

                if (answer.trim().toLowerCase() !== 'yes') {
                    return false;
                }

                await (await store()).recordAccepted(challenge, {
                    approved: true,
                    previousFingerprint: inspection.previousFingerprint,
                });

                return true;
            } finally {
                prompt.removeListener('close', closed);
                promptController.abort();
                prompt.close();
            }
        },
    };
}
