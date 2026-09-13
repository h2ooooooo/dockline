export class CliUsageError extends Error {
    public readonly code = 'DOCKLINE_USAGE_ERROR';

    public constructor(message: string) {
        super(message);
        this.name = 'CliUsageError';
    }
}

/** Server-controlled text must never become terminal control sequences. */
export function terminalText(value: string): string {
    return Array.from(value, character => {
        const code = character.charCodeAt(0);

        return code <= 31 || (code >= 127 && code <= 159) ?
            `\\u${code.toString(16).padStart(4, '0')}` : character;
    }).join('');
}

export function redactText(value: string, secrets: readonly string[]): string {
    let result = value;

    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
        result = result.split(secret).join('[redacted]');
    }

    return result;
}
