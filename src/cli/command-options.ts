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
};

const SHARED_OPTIONS = new Set(['help', 'version']);

export function takes(command: Command, option: string): boolean {
    return command === 'check' || SHARED_OPTIONS.has(option) || COMMAND_OPTIONS[command].includes(option);
}
