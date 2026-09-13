import type {Readable, Writable} from 'node:stream';

export interface CliContext {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: Readable & {isTTY?: boolean};
    stdout?: Writable & {isTTY?: boolean};
    stderr?: Writable & {isTTY?: boolean};
    signal?: AbortSignal;
}

export interface ResolvedCliContext extends CliContext {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdin: Readable & {isTTY?: boolean};
    stdout: Writable & {isTTY?: boolean};
    stderr: Writable & {isTTY?: boolean};
}

export function resolveContext(context: CliContext): ResolvedCliContext {
    return {
        cwd: context.cwd ?? process.cwd(),
        env: context.env ?? process.env,
        stdin: context.stdin ?? process.stdin,
        stdout: context.stdout ?? process.stdout,
        stderr: context.stderr ?? process.stderr,
        signal: context.signal,
    };
}
