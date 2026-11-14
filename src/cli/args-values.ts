import type { parseArgs } from 'node:util';

import { closest } from '../core/paths/suggest.ts';
import { HELP } from './help.ts';
import { UsageError } from './usage-error.ts';

/** The long name an option error of Node's names (`-c, --config <value>`, `--stdin`, `-q`). */
const OPTION_IN_MESSAGE = /[Oo]ption '(?:-\w, )?(-[\w-]+)/u;

export function wholeNumber(option: string, value: string | undefined, minimum: number): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const number = /^\d+$/u.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < minimum) {
        throw new UsageError(`${option} must be a whole number of ${minimum} or more, not "${value}"`);
    }
    return number;
}

/**
 * `--max-warnings` is a whole number, or -1 for no limit (as in ESLint). `Number()` took `0x10`, `1e3`,
 * ` 5` and the empty string (as 0); a limit is read as written.
 */
export function maxWarningsOf(value: string | undefined): number | undefined {
    if (value === undefined || value === '-1') {
        return undefined;
    }
    if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new UsageError(`--max-warnings must be a whole number of 0 or more, or -1 for no limit, not "${value}"`);
    }
    return Number(value);
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

/** A report goes to a file: blank or ending in a separator, it names a folder. */
export function refuseFolder(option: string, target: string): void {
    if (target.trim() === '' || /[/\\]$/u.test(target)) {
        throw new UsageError(
            `${option}: give the file to write${target.trim() === '' ? '' : `, such as ${target}crowded-folders.sarif`}; that is a folder`,
        );
    }
}

/** What the commands for AI agents refuse: a missing path, an agent that is not Claude, an option on its own. */
export function refuseAgentMisuse(input: {
    readonly command: string;
    readonly paths: readonly string[];
    readonly values: {
        readonly 'fail-on'?: string | undefined;
        readonly 'dry-run'?: boolean | undefined;
        readonly agents?: boolean | undefined;
        readonly help?: boolean | undefined;
    };
    readonly outputs: readonly { readonly format: string; readonly target: string | undefined }[];
}): void {
    const { command, paths, values, outputs } = input;
    if (command === 'where' && paths.length === 0 && !values.help) {
        throw new UsageError('where takes the path of a new file: crowded-folders where src/components/new-card.ts');
    }
    if (command === 'hook' && (paths.length !== 1 || paths[0] !== 'claude') && !values.help) {
        throw new UsageError(
            'hook takes the agent it answers: crowded-folders hook claude (Cursor has no hook that can warn without blocking)',
        );
    }
    if (values['fail-on'] !== undefined && values['fail-on'] !== 'worse') {
        throw new UsageError(`--fail-on must be worse, not "${values['fail-on']}"`);
    }
    if (values['dry-run'] && !values.agents) {
        throw new UsageError('--dry-run goes with init --agents: it prints the diff of what that would change');
    }
    if (command === 'init' && values.agents && paths.length > 0) {
        throw new UsageError('init --agents takes no paths: it works on the root of the repository');
    }
    if (command === 'where' && outputs.some(spec => spec.target !== undefined)) {
        throw new UsageError('where prints to standard output: -f text or -f json');
    }
    if (command === 'where' && outputs.some(spec => spec.format !== 'text' && spec.format !== 'json')) {
        throw new UsageError('where prints text or json: -f json');
    }
}

/**
 * `--moves` alone prints the moves in the report, and `--moves=sh` only the moves: the parser has no
 * option that may go without its value, so a bare `--moves` is read as `--moves=`. Arguments after
 * `--` are left alone.
 */
export function withMovesValue(argv: readonly string[]): string[] {
    const end = argv.indexOf('--');
    return argv.map((arg, index) => (arg === '--moves' && (end === -1 || index < end) ? '--moves=' : arg));
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

/** The options that may be given more than once; every other is an error the second time. */
const REPEATABLE = new Set(['preset', 'format', 'owner', 'suppress-rule']);

type Tokens = NonNullable<ReturnType<typeof parseArgs>['tokens']>;

/** `-f json -f sarif` used to keep the last one without a word; so did `-c a -c b`. */
export function refuseRepeated(tokens: Tokens): void {
    const seen = new Set<string>();
    for (const token of tokens) {
        if (token.kind !== 'option' || REPEATABLE.has(token.name)) {
            continue;
        }
        if (seen.has(token.name)) {
            throw new UsageError(`--${token.name} is given more than once, and it takes one value`);
        }
        seen.add(token.name);
    }
}
