import type { parseArgs } from 'node:util';

import type { Command, Format } from './args.ts';

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

/**
 * The options that change one report, and the formats that read them. Given with none of these, the option
 * would be ignored: `--stats` with the text, `--depth` with the JSON, `--group-by` with the Markdown.
 */
const FORMAT_OPTIONS: Readonly<Record<string, readonly Format[]>> = {
    stats: ['json'],
    'no-files': ['json'],
    depth: ['tree'],
    over: ['tree'],
    near: ['tree'],
    'group-by': ['text'],
    'max-findings': ['github', 'markdown'],
    // A bare --moves prints the moves in the text; --moves=sh writes them itself, whatever the reports.
    moves: ['text'],
};

/** What `auto` can turn into, by the CI it runs on (`resolveFormat`): what any of them reads is read. */
const AUTO: readonly Format[] = ['github', 'azure', 'text'];

/** The message for the first option that no report asked for reads, or `undefined`. */
export function optionWithoutReport(tokens: Tokens, formats: readonly Format[]): string | undefined {
    const given = new Set(formats.flatMap(format => (format === 'auto' ? AUTO : format)));
    for (const token of tokens) {
        if (token.kind !== 'option') {
            continue;
        }
        const readers = FORMAT_OPTIONS[token.name];
        const script = token.name === 'moves' && token.value !== '';
        if (readers !== undefined && !script && readers.every(format => !given.has(format))) {
            return `--${token.name} applies to --format ${readers.join(' or ')}`;
        }
    }
    return undefined;
}
