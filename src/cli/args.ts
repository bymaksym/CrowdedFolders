import { parseArgs } from 'node:util';

export const COMMANDS = ['check', 'init', 'explain', 'presets', 'rules', 'print-config'] as const;
export type Command = (typeof COMMANDS)[number];

export const FORMATS = [
    'text',
    'json',
    'sarif',
    'github',
    'markdown',
    'gitlab',
    'checkstyle',
    'azure',
    'auto',
] as const;
export type Format = (typeof FORMATS)[number];

export const GROUPINGS = ['folder', 'project', 'owner'] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** One report to write: in a format, to a file (`undefined` and `-`: standard output). */
export interface OutputSpec {
    readonly format: Format;
    readonly target: string | undefined;
}

export interface Args {
    readonly command: Command;
    readonly paths: readonly string[];
    readonly config: string | undefined;
    readonly root: string | undefined;
    readonly presets: readonly string[];
    /** The first of `outputs`: what `--format` and `--output` said when there is one report. */
    readonly format: Format;
    readonly output: string | undefined;
    /** Every report to write, from `-f format`, `-f format=file` and `-o`. */
    readonly outputs: readonly OutputSpec[];
    /** `--max-findings`: how many problems the Markdown lists, and how many annotations GitHub gets per kind. */
    readonly maxFindings: number | undefined;
    /** `--no-files`: leave the files and moves out of each finding of the JSON. */
    readonly files: boolean;
    /** `--stats`: the JSON also lists every folder with its numbers. */
    readonly stats: boolean;
    readonly groupBy: Grouping;
    /** `--owner`: only the problems of these CODEOWNERS owners. */
    readonly owners: readonly string[];
    /** `--base`: the ref a change is compared with, to anchor annotations on the files it adds. */
    readonly base: string | undefined;
    readonly stdin: boolean;
    readonly git: boolean;
    /** `--require-git`: stop when git cannot list the files. `undefined` when not given: on when CI is set. */
    readonly requireGit: boolean | undefined;
    readonly maxWarnings: number | undefined;
    readonly quiet: boolean;
    readonly moves: boolean;
    readonly color: boolean | undefined;
    readonly suppressAll: boolean;
    readonly suppressRules: readonly string[];
    readonly pruneSuppressions: boolean;
    readonly passOnUnprunedSuppressions: boolean;
    readonly suppressionsLocation: string | undefined;
    /** `--since <ref>`: check only the folders the change since `ref` reshaped. */
    readonly since: string | undefined;
    /** `--changed`: `--since` the pull request's base, read from the CI's environment. */
    readonly changed: boolean;
    /** `--new-since <ref>`: fail only on problems that are new or grew since `ref`. */
    readonly newSince: string | undefined;
    readonly force: boolean;
    readonly help: boolean;
    readonly version: boolean;
}

export class UsageError extends Error {
    override readonly name = 'UsageError';
}

/** Reads the command line. Anything it does not know is an error, never ignored. */
export function parseCommandLine(argv: readonly string[]): Args {
    let parsed;
    try {
        parsed = parseArgs({
            args: [...argv],
            allowPositionals: true,
            strict: true,
            options: {
                config: { type: 'string', short: 'c' },
                root: { type: 'string' },
                preset: { type: 'string', short: 'p', multiple: true },
                format: { type: 'string', short: 'f', multiple: true },
                output: { type: 'string', short: 'o' },
                'max-findings': { type: 'string' },
                'no-files': { type: 'boolean' },
                stats: { type: 'boolean' },
                'group-by': { type: 'string' },
                owner: { type: 'string', multiple: true },
                base: { type: 'string' },
                stdin: { type: 'boolean' },
                'no-git': { type: 'boolean' },
                'require-git': { type: 'boolean' },
                'max-warnings': { type: 'string' },
                quiet: { type: 'boolean', short: 'q' },
                moves: { type: 'boolean' },
                color: { type: 'boolean' },
                'no-color': { type: 'boolean' },
                'suppress-all': { type: 'boolean' },
                'suppress-rule': { type: 'string', multiple: true },
                'prune-suppressions': { type: 'boolean' },
                'pass-on-unpruned-suppressions': { type: 'boolean' },
                'suppressions-location': { type: 'string' },
                since: { type: 'string' },
                changed: { type: 'boolean' },
                'new-since': { type: 'string' },
                force: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
            },
        });
    } catch (error) {
        throw new UsageError((error as Error).message);
    }
    const { values, positionals } = parsed;

    const [first, ...rest] = positionals;
    const isCommand = (COMMANDS as readonly string[]).includes(first ?? '');
    const command: Command = isCommand ? (first as Command) : 'check';
    const paths = isCommand ? rest : positionals;

    const outputs = outputsOf(values.format ?? [], values.output);
    const groupBy = values['group-by'] ?? 'folder';
    if (!(GROUPINGS as readonly string[]).includes(groupBy)) {
        throw new UsageError(`--group-by must be one of ${GROUPINGS.join(', ')}, not "${groupBy}"`);
    }
    const maxFindings = wholeNumber('--max-findings', values['max-findings'], 1);
    let maxWarnings: number | undefined;
    if (values['max-warnings'] !== undefined) {
        maxWarnings = Number(values['max-warnings']);
        if (!Number.isSafeInteger(maxWarnings) || maxWarnings < 0) {
            throw new UsageError(`--max-warnings must be a whole number of 0 or more, not "${values['max-warnings']}"`);
        }
    }
    if (values.color && values['no-color']) {
        throw new UsageError('--color and --no-color cannot both be given');
    }
    if (values['suppress-all'] && values['suppress-rule']) {
        throw new UsageError(
            '--suppress-all and --suppress-rule cannot both be given: one suppresses everything, the other only some rules',
        );
    }
    if (values.stdin && values['no-git']) {
        throw new UsageError(
            '--stdin and --no-git cannot both be given: with --stdin the files come from standard input',
        );
    }
    if (values['require-git'] && (values['no-git'] || values.stdin)) {
        throw new UsageError(
            `--require-git and ${values.stdin ? '--stdin' : '--no-git'} cannot both be given: one asks git for the files, the other does not`,
        );
    }
    if (values.since !== undefined && values.changed) {
        throw new UsageError('--since and --changed cannot both be given: --changed is --since the base the CI names');
    }
    if ((values.since !== undefined || values.changed) && command === 'check' && paths.length > 0) {
        throw new UsageError(
            `${values.changed ? '--changed' : '--since'} and folders cannot both be given: it checks the folders the change reshaped`,
        );
    }
    for (const [flag, ref] of [
        ['--since', values.since],
        ['--new-since', values['new-since']],
        ['--base', values.base],
    ] as const) {
        if (ref?.trim() === '') {
            throw new UsageError(`${flag} needs a ref: ${flag} origin/main`);
        }
    }
    if ((values.since !== undefined || values.changed || values['new-since'] !== undefined) && values['no-git']) {
        throw new UsageError(
            '--since, --changed and --new-since compare with git, and --no-git reads the disk: the two lists would differ in what .gitignore hides',
        );
    }
    if (command === 'explain' && paths.length !== 1 && !values.help) {
        throw new UsageError('explain takes one folder: crowded-folders explain src/components');
    }
    if ((command === 'presets' || command === 'rules') && paths.length > 0) {
        throw new UsageError(`${command} takes no paths`);
    }

    return {
        command,
        paths,
        config: values.config,
        root: values.root,
        presets: values.preset ?? [],
        format: outputs[0]?.format ?? 'text',
        output: outputs[0]?.target,
        outputs,
        maxFindings,
        files: !(values['no-files'] ?? false),
        stats: values.stats ?? false,
        groupBy: groupBy as Grouping,
        owners: values.owner ?? [],
        base: values.base,
        stdin: values.stdin ?? false,
        git: !(values['no-git'] ?? false),
        requireGit: values['require-git'],
        maxWarnings,
        quiet: values.quiet ?? false,
        moves: values.moves ?? false,
        color: values['no-color'] ? false : values.color,
        suppressAll: values['suppress-all'] ?? false,
        suppressRules: values['suppress-rule'] ?? [],
        pruneSuppressions: values['prune-suppressions'] ?? false,
        passOnUnprunedSuppressions: values['pass-on-unpruned-suppressions'] ?? false,
        suppressionsLocation: values['suppressions-location'],
        since: values.since,
        changed: values.changed ?? false,
        newSince: values['new-since'],
        force: values.force ?? false,
        help: values.help ?? false,
        version: values.version ?? false,
    };
}

/**
 * Reads `-f` and `-o`. `-f github -f sarif=out.sarif -f markdown=$GITHUB_STEP_SUMMARY` writes three
 * reports in one run; `-f sarif -o out.sarif` still works. Only one report can go to standard output.
 */
function outputsOf(formats: readonly string[], output: string | undefined): OutputSpec[] {
    const specs: OutputSpec[] = formats.map(value => {
        const equals = value.indexOf('=');
        const format = equals === -1 ? value : value.slice(0, equals);
        if (!(FORMATS as readonly string[]).includes(format)) {
            throw new UsageError(`--format must be one of ${FORMATS.join(', ')}, not "${format}"`);
        }
        const target = equals === -1 ? undefined : value.slice(equals + 1);
        if (target === '') {
            throw new UsageError(`--format ${value}: the file after "=" is empty`);
        }
        if (target !== undefined) {
            refuseFolder(`--format ${value}`, target);
        }
        return { format: format as Format, target: target === '-' ? undefined : target };
    });
    if (specs.length === 0) {
        specs.push({ format: 'text', target: undefined });
    }
    if (output !== undefined) {
        refuseFolder(`--output ${output}`, output);
        const [only] = specs;
        if (specs.length !== 1 || only === undefined || (only.target !== undefined && formats.length > 0)) {
            throw new UsageError(
                '--output goes with one --format that has no file of its own; with several, name each file: -f sarif=out.sarif -f markdown=summary.md',
            );
        }
        specs[0] = { format: only.format, target: output };
    }
    if (specs.filter(spec => spec.target === undefined).length > 1) {
        throw new UsageError(
            'only one report can go to standard output: give the others a file, as in -f github -f sarif=out.sarif',
        );
    }
    return specs;
}

/** A report goes to a file: blank or ending in a separator, it names a folder. */
function refuseFolder(option: string, target: string): void {
    if (target.trim() === '' || /[/\\]$/u.test(target)) {
        throw new UsageError(
            `${option}: give the file to write${target.trim() === '' ? '' : `, such as ${target}crowded-folders.sarif`}; that is a folder`,
        );
    }
}

function wholeNumber(option: string, value: string | undefined, minimum: number): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const number = /^\d+$/u.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < minimum) {
        throw new UsageError(`${option} must be a whole number of ${minimum} or more, not "${value}"`);
    }
    return number;
}
