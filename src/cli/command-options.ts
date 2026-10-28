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
    init: [...REPOSITORY_OPTIONS, 'force'],
    explain: REPOSITORY_OPTIONS,
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
};

const SHARED_OPTIONS = new Set(['help', 'version']);

export function takes(command: Command, option: string): boolean {
    return command === 'check'
        ? option !== 'samples'
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
