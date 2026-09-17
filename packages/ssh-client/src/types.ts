export interface SshOptions {
    password?: string;
    passphrase?: string;
    host?: string;
    port?: number;
    username?: string;
    privateKeyPath?: string;
    agent?: string;
    keyboardInteractive?: boolean;
    hostFingerprint?: string;
    sudo?: {password?: 'prompt' | 'none'; passwordEnv?: string};
}
export interface Question {
    id: string;
    message: string;
    type: 'password' | 'input';
    required?: boolean;
}
export function milliseconds(value: string | number): number {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
    const scales: Record<string, number> = {
        ms: 1,
        s: 1000,
        m: 60000,
        h: 3600000,
    };
    const result = typeof value === 'number' ? value : match ? Number(match[1]) * scales[match[2]] : 0;

    if (!Number.isFinite(result) || result <= 0 || result > 2147483647) {
        throw new Error('Invalid positive timeout.');
    }

    return Math.ceil(result);
}
