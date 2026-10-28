import { parseArgs } from 'node:util';

import {
    joinNegativeOne,
    maxWarningsOf,
    refuseAgentMisuse,
    refuseFolder,
    usageMessageOf,
    wholeNumber,
    withMovesValue,
} from './args-values.ts';
import { optionNotTaken } from './command-options.ts';
import { UsageError } from './usage-error.ts';

export const COMMANDS = [
    'check',
    'init',
    'explain',
    'where',
    'hook',
    'presets',
    'rules',
    'print-config',
    'overrides',
    'history',
    'tree',
] as const;
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
    'html',
    'badge',
    'tree',
    'auto',
] as const;
export type Format = (typeof FORMATS)[number];

/** What `--moves=<what>` writes to standard output instead of the report: the moves alone. */
export const MOVE_SCRIPTS = ['sh', 'pwsh', 'json'] as const;
export type MoveScript = (typeof MOVE_SCRIPTS)[number];

export const GROUPINGS = ['folder', 'project', 'owner'] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** One report to write: in a format, to a file (`undefined` and `-`: standard output). */
export interface OutputSpec {
    readonly format: Format;
    readonly target: string | undefined;
    /**
     * The words that asked for this report, for the message that names it: `--output x` or
     * `--format json=x`. Remembered from the command line so that an error never names the other form.
     */
    readonly option: string;
}

export interface Args {
    readonly command: Command;
    /** Whether the command was written (`check` is the one that is not). */
    readonly commandGiven: boolean;
    readonly paths: readonly string[];
    readonly config: string | undefined;
    readonly root: string | undefined;
    /** `--project <dir>`: check only this folder, with the repository's configuration and suppressions. */
    readonly project: string | undefined;
    readonly presets: readonly string[];
    /** `--no-detect`: without a configuration, use only the presets given with `--preset`. */
    readonly detect: boolean;
    /** `--no-code`: read only JSON configurations; no JavaScript configuration or plugin runs. */
    readonly code: boolean;
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
    /** `tree`: how many levels below the folder are shown. */
    readonly depth: number;
    /** `tree --over` or `--near`: only the folders over their limit, or near it too. */
    readonly only: 'near' | 'over' | undefined;
    readonly groupBy: Grouping;
    /** `--owner`: only the problems of these CODEOWNERS owners. */
    readonly owners: readonly string[];
    /** `--base`: the ref a change is compared with, to anchor annotations on the files it adds. */
    readonly base: string | undefined;
    readonly stdin: boolean;
    readonly git: boolean;
    /** `--require-git`: stop when git cannot list the files. `undefined` when not given: on when CI is set. */
    readonly requireGit: boolean | undefined;
    /**
     * `--tracked-only`: count only the files git tracks, not the ones it would add (a file a previous CI
     * step left behind). `--no-tracked-only` is `false`; `undefined` when neither is given: on when CI is set.
     */
    readonly trackedOnly: boolean | undefined;
    readonly maxWarnings: number | undefined;
    readonly quiet: boolean;
    /** `--moves`: the text report prints the moves under each problem. */
    readonly moves: boolean;
    /** `--moves=sh|pwsh|json`: standard output gets only the moves, as commands for that shell or as JSON. */
    readonly movesScript: MoveScript | undefined;
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
    /** `history --samples <n>`: how many commits to measure. */
    readonly samples: number | undefined;
    /** `--compare-config <ref>`: also say what the configuration changed since `ref`. */
    readonly compareConfig: string | undefined;
    readonly force: boolean;
    /** `where --fail-on worse`: exit 1 when a file would create or worsen a problem. */
    readonly failOn: 'worse' | undefined;
    /** `explain --prompt`: print the reorganisation task for an agent instead of the explanation. */
    readonly prompt: boolean;
    /** `init --agents`: add the hook and the notes for AI agents instead of writing a configuration. */
    readonly agents: boolean;
    /** `init --agents --dry-run`: print what would change as a diff, and change nothing. */
    readonly dryRun: boolean;
    readonly help: boolean;
    readonly version: boolean;
}

export { UsageError } from './usage-error.ts';

/** The options every command that reads a repository takes: where it is and how its files are listed. */

/** Reads the command line. Anything it does not know, repeat or cannot use is an error, never ignored. */
export function parseCommandLine(argv: readonly string[]): Args {
    let parsed;
    try {
        parsed = parseArgs({
            args: joinNegativeOne(withMovesValue(argv)),
            allowPositionals: true,
            strict: true,
            tokens: true,
            options: {
                config: { type: 'string', short: 'c' },
                root: { type: 'string' },
                project: { type: 'string' },
                preset: { type: 'string', short: 'p', multiple: true },
                'no-detect': { type: 'boolean' },
                'no-code': { type: 'boolean' },
                format: { type: 'string', short: 'f', multiple: true },
                output: { type: 'string', short: 'o' },
                'max-findings': { type: 'string' },
                'no-files': { type: 'boolean' },
                stats: { type: 'boolean' },
                depth: { type: 'string' },
                over: { type: 'boolean' },
                near: { type: 'boolean' },
                'group-by': { type: 'string' },
                owner: { type: 'string', multiple: true },
                base: { type: 'string' },
                stdin: { type: 'boolean' },
                'no-git': { type: 'boolean' },
                'require-git': { type: 'boolean' },
                'tracked-only': { type: 'boolean' },
                'no-tracked-only': { type: 'boolean' },
                'max-warnings': { type: 'string' },
                quiet: { type: 'boolean', short: 'q' },
                moves: { type: 'string' },
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
                samples: { type: 'string' },
                'compare-config': { type: 'string' },
                force: { type: 'boolean' },
                'fail-on': { type: 'string' },
                prompt: { type: 'boolean' },
                agents: { type: 'boolean' },
                'dry-run': { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean', short: 'v' },
            },
        });
    } catch (error) {
        throw new UsageError(usageMessageOf(error as Error));
    }
    const { values, positionals, tokens } = parsed;
    refuseRepeated(tokens);

    const [first, ...rest] = positionals;
    const isCommand = (COMMANDS as readonly string[]).includes(first ?? '');
    const command: Command = isCommand ? (first as Command) : 'check';
    const paths = isCommand ? rest : positionals;
    if (!values.help && !values.version) {
        const notTaken = optionNotTaken(command, tokens, COMMANDS);
        if (notTaken !== undefined) {
            throw new UsageError(notTaken);
        }
    }

    const movesScript = moveScriptOf(values.moves);
    const outputs = outputsOf(
        values.format ?? [],
        values.output,
        movesScript !== undefined,
        command === 'tree' ? 'tree' : 'text',
    );
    if (values.over && values.near) {
        throw new UsageError(
            '--over and --near cannot both be given: --near already shows the folders over their limit',
        );
    }
    const groupBy = values['group-by'] ?? 'folder';
    if (!(GROUPINGS as readonly string[]).includes(groupBy)) {
        throw new UsageError(`--group-by must be one of ${GROUPINGS.join(', ')}, not "${groupBy}"`);
    }
    const maxFindings = wholeNumber('--max-findings', values['max-findings'], 1);
    const maxWarnings = maxWarningsOf(values['max-warnings']);
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
    if (values['tracked-only'] && values['no-tracked-only']) {
        throw new UsageError('--tracked-only and --no-tracked-only cannot both be given');
    }
    if (values['tracked-only'] && (values['no-git'] || values.stdin)) {
        throw new UsageError(
            `--tracked-only and ${values.stdin ? '--stdin' : '--no-git'} cannot both be given: tracked files are what git lists`,
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
        ['--compare-config', values['compare-config']],
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
    refuseAgentMisuse({ command, paths, values, outputs });
    if ((command === 'presets' || command === 'rules') && paths.length > 1) {
        throw new UsageError(`${command} takes one name to filter by: crowded-folders ${command} ${paths[0] ?? ''}`);
    }
    if (command === 'history' && paths.length > 1) {
        throw new UsageError(
            'history takes one folder, or none for the folders that grew most: crowded-folders history src/cli',
        );
    }
    if (command === 'history' && values.format?.some(value => !['text', 'json'].includes(value))) {
        throw new UsageError('history prints text or json: --format json');
    }
    if (command === 'overrides' && paths.length > 0) {
        throw new UsageError('overrides takes no paths');
    }
    if (values.project !== undefined && values.root !== undefined) {
        throw new UsageError(
            '--project and --root cannot both be given: --project checks one folder of the repository, from its root',
        );
    }
    if (values.project?.trim() === '') {
        throw new UsageError('--project needs a folder: --project packages/api');
    }
    if (values.project !== undefined && command === 'check' && paths.length > 0) {
        throw new UsageError('--project and folders cannot both be given: --project is the folder checked');
    }

    return {
        command,
        commandGiven: isCommand,
        paths,
        config: values.config,
        root: values.root,
        project: values.project,
        presets: values.preset ?? [],
        detect: !(values['no-detect'] ?? false),
        code: !(values['no-code'] ?? false),
        format: outputs[0]?.format ?? 'text',
        output: outputs[0]?.target,
        outputs,
        maxFindings,
        files: !(values['no-files'] ?? false),
        stats: values.stats ?? false,
        depth: depthOf(values.depth),
        only: values.over ? 'over' : values.near ? 'near' : undefined,
        groupBy: groupBy as Grouping,
        owners: values.owner ?? [],
        base: values.base,
        stdin: values.stdin ?? false,
        git: !(values['no-git'] ?? false),
        requireGit: values['require-git'],
        trackedOnly: values['no-tracked-only'] ? false : values['tracked-only'],
        maxWarnings,
        quiet: values.quiet ?? false,
        moves: values.moves !== undefined,
        movesScript,
        color: values['no-color'] ? false : values.color,
        suppressAll: values['suppress-all'] ?? false,
        suppressRules: values['suppress-rule'] ?? [],
        pruneSuppressions: values['prune-suppressions'] ?? false,
        passOnUnprunedSuppressions: values['pass-on-unpruned-suppressions'] ?? false,
        suppressionsLocation: values['suppressions-location'],
        since: values.since,
        changed: values.changed ?? false,
        newSince: values['new-since'],
        samples: wholeNumber('--samples', values.samples, 2),
        compareConfig: values['compare-config'],
        force: values.force ?? false,
        failOn: values['fail-on'] === 'worse' ? 'worse' : undefined,
        prompt: values.prompt ?? false,
        agents: values.agents ?? false,
        dryRun: values['dry-run'] ?? false,
        help: values.help ?? false,
        version: values.version ?? false,
    };
}

/**
 * Reads `-f` and `-o`. `-f github -f sarif=out.sarif -f markdown=$GITHUB_STEP_SUMMARY` writes three
 * reports in one run; `-f sarif -o out.sarif` still works. Only one report can go to standard output.
 */
function outputsOf(
    formats: readonly string[],
    output: string | undefined,
    movesToStdout: boolean,
    defaultFormat: Format,
): OutputSpec[] {
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
        return {
            format: format as Format,
            target: target === '-' ? undefined : target,
            option: target === undefined ? `--format ${format}` : `--format ${value}`,
        };
    });
    if (specs.length === 0 && !(movesToStdout && output === undefined)) {
        specs.push({ format: defaultFormat, target: undefined, option: `--format ${defaultFormat}` });
    }
    if (output !== undefined) {
        refuseFolder(`--output ${output}`, output);
        const [only] = specs;
        if (specs.length !== 1 || only === undefined || (only.target !== undefined && formats.length > 0)) {
            throw new UsageError(
                '--output goes with one --format that has no file of its own; with several, name each file: -f sarif=out.sarif -f markdown=summary.md',
            );
        }
        specs[0] = { format: only.format, target: output, option: `--output ${output}` };
    }
    if (movesToStdout && specs.some(spec => spec.target === undefined)) {
        throw new UsageError(
            '--moves=<shell> writes the moves to standard output, and so would this --format: give the report a file, as in -f json=report.json',
        );
    }
    if (specs.filter(spec => spec.target === undefined).length > 1) {
        throw new UsageError(
            'only one report can go to standard output: give the others a file, as in -f github -f sarif=out.sarif',
        );
    }
    return specs;
}

function moveScriptOf(value: string | undefined): MoveScript | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }
    if (!(MOVE_SCRIPTS as readonly string[]).includes(value)) {
        throw new UsageError(`--moves takes no value, or one of ${MOVE_SCRIPTS.join(', ')}, not "${value}"`);
    }
    return value as MoveScript;
}

/** How deep `tree` goes by default: the folders a person looks at first, with what is below them counted. */
export const DEFAULT_TREE_DEPTH = 3;

/** `--depth 2`, or `--depth all`: a whole number of levels, read as written. */
function depthOf(value: string | undefined): number {
    if (value === undefined) {
        return DEFAULT_TREE_DEPTH;
    }
    return value === 'all' ? Number.MAX_SAFE_INTEGER : (wholeNumber('--depth', value, 0) ?? DEFAULT_TREE_DEPTH);
}

/** The options that may be given more than once; every other is an error the second time. */
const REPEATABLE = new Set(['preset', 'format', 'owner', 'suppress-rule']);

type Tokens = NonNullable<ReturnType<typeof parseArgs>['tokens']>;

/** `-f json -f sarif` used to keep the last one without a word; so did `-c a -c b`. */
function refuseRepeated(tokens: Tokens): void {
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
