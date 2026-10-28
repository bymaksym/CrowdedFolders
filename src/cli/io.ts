import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What the command needs from the outside world; tests pass their own. */
export interface Io {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly stdoutIsTTY: boolean;
    /** The width of the terminal in columns, when standard output is one. */
    readonly columns?: number | undefined;
    write(text: string): void;
    error(text: string): void;
    readStdin(): Promise<string>;
}

export function processIo(): Io {
    return {
        cwd: process.cwd(),
        env: process.env,
        stdoutIsTTY: process.stdout.isTTY,
        columns: process.stdout.columns,
        write: text => process.stdout.write(text),
        error: text => process.stderr.write(text),
        readStdin: async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
                chunks.push(chunk as Buffer);
            }
            return Buffer.concat(chunks).toString('utf8');
        },
    };
}

/**
 * Writes a file whole or not at all: to a temporary file first, then renamed over the target. A run
 * stopped halfway leaves the old file, never half of the new one.
 */
export function writeFileAtomic(path: string, content: string): void {
    const temporary = `${path}.${process.pid}.tmp`;
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temporary, content, 'utf8');
        renameSync(temporary, path);
    } catch (error) {
        rmSync(temporary, { force: true });
        throw new WriteError(path, error);
    }
}

/** A file the command was asked to write cannot be written: a folder in the way, no permission, a full disk. */
export class WriteError extends Error {
    override readonly name = 'WriteError';

    constructor(path: string, cause: unknown) {
        super(`cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
}

/** Colours on a terminal, off when piped; `NO_COLOR` and `FORCE_COLOR` win, and the flags win over both. */
export function wantsColor(flag: boolean | undefined, io: Io): boolean {
    if (flag !== undefined) {
        return flag;
    }
    if (io.env['NO_COLOR'] !== undefined && io.env['NO_COLOR'] !== '') {
        return false;
    }
    const force = io.env['FORCE_COLOR'];
    return force === undefined ? io.stdoutIsTTY : force !== '0' && force !== 'false';
}

/**
 * Symbols (✖ ⚠ ✔) on a terminal, words when there is none: a pipe, a log, `TERM=dumb`, a console that
 * prints `?`, a screen reader. `FORCE_COLOR` is somebody asking for the full look in a log that shows it.
 */
export function wantsSymbols(io: Io): boolean {
    if (io.env['TERM'] === 'dumb') {
        return false;
    }
    const force = io.env['FORCE_COLOR'];
    return io.stdoutIsTTY || (force !== undefined && force !== '' && force !== '0' && force !== 'false');
}

/** What to type for this command in a tip: through `npx` (or `dlx`) it is not on the PATH. */
export function commandName(io: Io): string {
    const how = io.env['npm_command'];
    return how === 'exec' || how === 'dlx' ? 'npx crowded-folders' : 'crowded-folders';
}

/** The terminal's width when it is one that wraps what it shows; `undefined` for a pipe. */
export function terminalWidth(io: Io): number | undefined {
    return io.stdoutIsTTY && io.columns !== undefined && io.columns > 0 ? io.columns : undefined;
}
