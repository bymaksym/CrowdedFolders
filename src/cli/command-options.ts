import type { parseArgs } from 'node:util';

import type { Command } from './args.ts';

const REPOSITORY_OPTIONS = [
    'config',
    'root',
    'project',
    'preset',
    'no-detect',
    'no-code',
    'stdin',
    'no-git',
    'require-git',
    'tracked-only',
] as const;

/**
 * The options each command takes besides `--help` and `--version`. Anything else is a usage error:
 * an option a command ignores is a flag that looks like it did something (`explain -f json` answering in
 * text, `rules --suppress-all` doing nothing). `check` takes all of them.
 */
const COMMAND_OPTIONS: Readonly<Record<Exclude<Command, 'check'>, readonly string[]>> = {
    init: [...REPOSITORY_OPTIONS, 'force', 'agents', 'dry-run'],
    explain: [...REPOSITORY_OPTIONS, 'prompt'],
    where: [...REPOSITORY_OPTIONS, 'format', 'fail-on'],
    // The agent's hook reads where it is from the JSON it is sent; these say which configuration to use.
    hook: ['config', 'root', 'no-code'],
    'print-config': REPOSITORY_OPTIONS,
    // The configuration found from --config or --root says which plugins add rules and presets to the lists.
    presets: ['config', 'root', 'no-code'],
    rules: ['config', 'root', 'no-code'],
    overrides: [...REPOSITORY_OPTIONS, 'format'],
    // History reads commits from git: no list from standard input or the disk.
    history: [
        ...REPOSITORY_OPTIONS.filter(option => !['stdin', 'no-git', 'require-git', 'tracked-only'].includes(option)),
        'format',
        'samples',
    ],
    tree: [...REPOSITORY_OPTIONS, 'format', 'output', 'depth', 'over', 'near', 'color', 'no-color'],
};

const SHARED_OPTIONS = new Set(['help', 'version']);

/** The options only another command takes: `check --prompt` or `check --samples 5` would be ignored. */
const NOT_FOR_CHECK = new Set(['samples', 'fail-on', 'prompt', 'agents', 'dry-run']);

export function takes(command: Command, option: string): boolean {
    return command === 'check'
        ? !NOT_FOR_CHECK.has(option)
        : SHARED_OPTIONS.has(option) || COMMAND_OPTIONS[command].includes(option);
}

type Tokens = NonNullable<ReturnType<typeof parseArgs>['tokens']>;

/**
 * An option the command does not take is not ignored: `explain -f json` answered in text, `rules
 * --suppress-all` did nothing. The message for the first one given, or `undefined`.
 */
export function optionNotTaken(command: Command, tokens: Tokens, commands: readonly Command[]): string | undefined {
    for (const token of tokens) {
        if (token.kind !== 'option' || takes(command, token.name)) {
            continue;
        }
        const where = commands.filter(other => takes(other, token.name));
        return `--${token.name} does not apply to ${command}${where.length === 0 ? '' : `; it applies to ${where.join(', ')}`}`;
    }
    return undefined;
}
