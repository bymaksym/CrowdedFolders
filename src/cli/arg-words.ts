import { closest } from '../core/paths/suggest.ts';
import { HELP } from './help.ts';

/** The long name an option error of Node's names (`-c, --config <value>`, `--stdin`, `-q`). */
const OPTION_IN_MESSAGE = /[Oo]ption '(?:-\w, )?(-[\w-]+)/u;

/**
 * `--moves` alone prints the moves in the report, and `--moves=sh` only the moves: the parser has no
 * option that may go without its value, so a bare `--moves` is read as `--moves=`. Arguments after
 * `--` are left alone.
 */
export function withMovesValue(argv: readonly string[]): string[] {
    const end = argv.indexOf('--');
    return argv.map((arg, index) => (arg === '--moves' && (end === -1 || index < end) ? '--moves=' : arg));
}

/** `--max-warnings -1` is two words to Node, which takes `-1` for an option: make it `--max-warnings=-1`. */
export function joinNegativeOne(argv: readonly string[]): string[] {
    const joined: string[] = [];
    for (const [index, word] of argv.entries()) {
        if (word === '-1' && argv[index - 1] === '--max-warnings') {
            joined[joined.length - 1] = '--max-warnings=-1';
        } else {
            joined.push(word);
        }
    }
    return joined;
}

/** Node's own words for a bad option are long, quote badly and suggest nothing: say it in one line. */
export function usageMessageOf(error: Error): string {
    const code = (error as Error & { code?: string }).code;
    const named = OPTION_IN_MESSAGE.exec(error.message)?.[1];
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && named !== undefined) {
        const long = named.startsWith('--') ? named.slice(2) : undefined;
        const candidates = new Set(HELP.match(/(?<=--)[a-z][a-z-]*/gu));
        const guess = long === undefined ? undefined : closest(long, candidates);
        return `unknown option ${named}${guess === undefined ? '' : `; did you mean --${guess}?`}`;
    }
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' && named !== undefined) {
        return error.message.includes('does not take an argument')
            ? `${named} takes no value`
            : `${named} needs a value; if the value starts with "-", write it ${named}=<value>`;
    }
    return error.message;
}
