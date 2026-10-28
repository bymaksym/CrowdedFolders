import { UsageError } from './usage-error.ts';

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
