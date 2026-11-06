import {CredentialProviderError} from '@jalsoedesign/dockline-abstract';

export type PrivateKeyFailure = 'passphrase-required' | 'integrity' | 'format' | 'unsupported' | 'resource-limit';

export class SshPrivateKeyError extends CredentialProviderError {
    public constructor(public readonly reason: PrivateKeyFailure, message: string) {
        super(message);
    }
}
