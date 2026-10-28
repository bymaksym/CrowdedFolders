import { resolve } from 'node:path';

import { foldersOf } from '../core/changes.ts';
import type { Config, Plugin, Preset, ResolvedConfig } from '../core/config/types.ts';
import { ConfigError } from '../core/config/validate.ts';
import { type EngineResult, type Finding, runEngine, selectFiles } from '../core/engine.ts';
import { FileListError, normaliseFileList } from '../core/paths/input.ts';
import type { Detection } from '../core/presets/detect.ts';
import { exitCodeOf } from '../core/report/report.ts';
import { attributeRuleError, RuleError, ruleShapeProblem } from '../core/rules/guard.ts';
import type { Rule } from '../core/rules/rule.ts';
import { applySuppressions, PER_PROJECT, type StaleSuppression } from '../core/suppressions.ts';
import { locate } from './config/file.ts';
import { listFiles } from './files.ts';
import { loadConfig, loadConfigFile, type LoadedConfig } from './load-config.ts';
import { detectConfig } from './manifests.ts';
import { SuppressionFiles, suppressionsPathFor } from './suppressions-files.ts';

export interface LinterOptions {
    /** Where relative paths start, and where to look for the configuration without `root`. Default: `process.cwd()`. */
    readonly cwd?: string;
    /**
     * A configuration object, or the path of a configuration file. Default: found from `root`, else
     * from `cwd`, upwards; with none, the presets detected in the repository, as the command does.
     */
    readonly config?: Config | string;
    /** The folder to check. Default: the configuration's folder, else the top of the git repository, else `cwd`. */
    readonly root?: string;
    /** Extra rules, as a plugin would add them, by full name. */
    readonly rules?: Readonly<Record<string, Rule>>;
    /**
     * The files presets are detected from, when there is no configuration (relative to the root).
     * Default: asked to git, or read from the disk.
     */
    readonly files?: readonly string[];
}

export interface LintOptions extends LinterOptions {
    /**
     * The files to check, relative to the root (`./a.ts` and `a\b.ts` are read as the command reads
     * them; an absolute path under the root is made relative to it). A path outside the root throws a
     * `FileListError`. Default: asked to git, or read from the disk outside a repository.
     */
    readonly files?: readonly string[];
    /**
     * Apply the suppressions file as the command does, so that `kept` and `exitCode` are what the
     * command would report and exit with: `true` for the file the configuration names (by default
     * `crowded-folders-suppressions.json` next to it), or a path from `cwd`. Default: `false`, every
     * finding is kept.
     */
    readonly suppressions?: boolean | string;
}

/** One run of a `Linter`. */
export interface LintRun {
    /** As `LintOptions.files`. Default: asked to git, or read from the disk, again on each run. */
    readonly files?: readonly string[];
    /** As `LintOptions.suppressions`; read again on each run. */
    readonly suppressions?: boolean | string;
    /** Only the folders equal to or under these (relative to the root) are checked: an editor's open folder. */
    readonly only?: readonly string[];
}

export interface LintResult extends EngineResult {
    readonly root: string;
    /** What the command reports: the findings no suppression covers (every finding without `suppressions`). */
    readonly kept: readonly Finding[];
    /** The findings a suppression covers. */
    readonly suppressed: readonly Finding[];
    /** The suppressions the command fails on until they are pruned. */
    readonly stale: readonly StaleSuppression[];
    /** What the command would exit with: 1 for an error or a stale suppression, else 0. */
    readonly exitCode: 0 | 1;
    /** The configuration file read, as an absolute path; `undefined` for a configuration object or none. */
    readonly configFile: string | undefined;
    /** The presets in effect, in the order applied. */
    readonly presets: readonly string[];
    /** The presets found in the repository and why, when there was no configuration. */
    readonly detected: readonly Detection[] | undefined;
}

/**
 * A configuration loaded once and run many times: for an editor, an agent's hook or a watch mode,
 * where loading the plugins again on each save would be most of the time. Each run lists the files
 * again (or takes them) and reads the suppressions again; the configuration, its plugins and the
 * detected presets stay as they were when it was made. Make another one when the configuration changes.
 */
export interface Linter {
    readonly root: string;
    readonly configFile: string | undefined;
    readonly presets: readonly string[];
    readonly detected: readonly Detection[] | undefined;
    readonly config: ResolvedConfig;
    readonly rules: Readonly<Record<string, Rule>>;
    readonly plugins: readonly Plugin[];
    readonly presetsByName: Readonly<Record<string, Preset>>;
    lint(run?: LintRun): LintResult;
}

const ORIGIN = '(the lint() options)';

/** Loads the configuration (and its plugins) once, for many runs. */
export async function createLinter(options: LinterOptions = {}): Promise<Linter> {
    const { linter } = await open(options);
    return linter;
}

/**
 * Checks a repository the way the command does, and returns the findings without printing them.
 * When the root is inside the configuration's folder, the configuration's patterns are read from its
 * folder, as the command reads them, and so are the folders of the findings.
 */
export async function lint(options: LintOptions = {}): Promise<LintResult> {
    const { linter, listed } = await open(options);
    const files = listed ?? options.files;
    return linter.lint({
        ...(files !== undefined && { files }),
        ...(options.suppressions !== undefined && { suppressions: options.suppressions }),
    });
}

async function open(options: LinterOptions): Promise<{ linter: Linter; listed: readonly string[] | undefined }> {
    const cwd = resolve(options.cwd ?? process.cwd());
    for (const [name, rule] of Object.entries(options.rules ?? {})) {
        const problem = ruleShapeProblem(rule);
        if (problem !== undefined) {
            throw new ConfigError(ORIGIN, [{ at: `rules[${JSON.stringify(name)}]`, message: `the rule ${problem}` }]);
        }
    }
    const configObject = typeof options.config === 'object' ? options.config : undefined;
    const given = typeof options.config === 'string' ? resolve(cwd, options.config) : undefined;
    const located = locate({
        cwd,
        configPath: given,
        root: options.root === undefined ? undefined : resolve(cwd, options.root),
    });
    const configPath = configObject === undefined ? located.configPath : undefined;
    const { root, base, scope } = configPath === undefined ? { ...located, base: located.root, scope: '.' } : located;

    let listed: readonly string[] | undefined;
    let detected: Detection[] | undefined;
    let loaded: LoadedConfig;
    if (configPath !== undefined) {
        loaded = await loadConfigFile(configPath, options.rules);
    } else if (configObject === undefined) {
        // No configuration: the presets of the repository, as the command detects them.
        listed = filesOf(options.files, root);
        const detection = detectConfig(root, listed);
        detected = detection.detected;
        loaded = await loadConfig(detection.config, ORIGIN, root, options.rules);
    } else {
        loaded = await loadConfig(configObject, ORIGIN, root, options.rules);
    }
    const presets = detected?.map(detection => detection.preset) ?? presetsOf(loaded.config.layers);
    const { config, rules } = loaded;

    const lintOnce = (run: LintRun = {}): LintResult => {
        const own = filesOf(run.files, root);
        const all = scope === '.' ? own : own.map(file => `${scope}/${file}`);
        const store = storeOf(run.suppressions, { cwd, base, configPath, config, files: all });
        const ownFiles = new Set(store.ownFiles());
        const files = ownFiles.size === 0 ? all : all.filter(file => !ownFiles.has(file));
        const only =
            run.only?.map(folder => (scope === '.' ? folder : `${scope}/${folder}`)) ??
            (scope === '.' ? undefined : [scope]);
        let result: EngineResult;
        try {
            result = runEngine({ files, config, rules, ...(only && { only }) });
        } catch (error) {
            throw error instanceof RuleError ? attributeRuleError(error, loaded.plugins) : error;
        }
        const inScope = only && ((folder: string): boolean => only.some(path => isUnder(folder, path)));
        let outcome = {
            kept: result.findings,
            suppressed: [] as readonly Finding[],
            stale: [] as readonly StaleSuppression[],
        };
        if (run.suppressions !== undefined && run.suppressions !== false) {
            let folders: Set<string> | undefined;
            const existing = (): Set<string> => (folders ??= foldersOf(selectFiles(files, config)));
            outcome = applySuppressions(result.findings, store.read(), {
                folderExists: folder => existing().has(folder),
                folders: existing,
                rules: new Set(Object.keys(rules)),
                ...(inScope && { inScope }),
            });
        }
        return {
            ...result,
            root: scope === '.' ? root : base,
            ...outcome,
            exitCode: exitCodeOf({ findings: outcome.kept, staleSuppressions: outcome.stale }),
            configFile: configPath,
            presets,
            detected,
        };
    };

    const linter: Linter = Object.freeze({
        root: scope === '.' ? root : base,
        configFile: configPath,
        presets,
        detected,
        config,
        rules,
        plugins: loaded.plugins,
        presetsByName: loaded.presets,
        lint: lintOnce,
    });
    return { linter, listed };
}

/** The files of a run: given (read as the command reads them), or listed. */
function filesOf(given: readonly string[] | undefined, root: string): readonly string[] {
    if (given === undefined) {
        return listFiles(root, { git: true }).files;
    }
    const read = normaliseFileList(given, root);
    if (read.problems.length > 0) {
        throw new FileListError(read.problems);
    }
    return read.files;
}

/**
 * The suppressions files of a run. Made even when they are not applied: the command never counts
 * its own suppressions file as a file of the folder it is in, and neither does `lint()`.
 */
function storeOf(
    suppressions: boolean | string | undefined,
    context: {
        readonly cwd: string;
        readonly base: string;
        readonly configPath: string | undefined;
        readonly config: ResolvedConfig;
        readonly files: readonly string[];
    },
): SuppressionFiles {
    const { cwd, base, configPath, config, files } = context;
    const location =
        typeof suppressions === 'string'
            ? resolve(cwd, suppressions)
            : config.suppressions === PER_PROJECT
              ? PER_PROJECT
              : suppressionsPathFor(config, configPath, base);
    return new SuppressionFiles(base, location, files);
}

/** The presets a configuration applied, from its layers, in order. */
function presetsOf(layers: readonly string[]): string[] {
    return layers
        .map(layer => /^preset "(.+)"$/u.exec(layer)?.[1])
        .filter((name): name is string => name !== undefined);
}

function isUnder(folder: string, path: string): boolean {
    return path === '.' || folder === path || folder.startsWith(`${path}/`);
}
