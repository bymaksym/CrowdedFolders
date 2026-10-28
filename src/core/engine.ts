import { applySetting, mergeNaming, mergeOptions } from './config/merge.ts';
import type { NamingState, OverrideState, ResolvedConfig, RuleState } from './config/types.ts';
import { compareText, modulesOf, type Naming } from './naming/modules.ts';
import { compileGlob, type Glob, matchesSelfOrAncestor } from './paths/glob.ts';
import { FileListError, normaliseFileList } from './paths/input.ts';
import { buildTree, type FolderEntry, joinPath } from './paths/tree.ts';
import type { FolderView, Move, Problem, Rule } from './rules/rule.ts';

/** One problem in one folder, as every output format receives it. */
export interface Finding {
    /** `max-files`, or `namespace/rule` for a plugin rule; `config/unused-override` for a stale override. */
    readonly rule: string;
    readonly severity: 'error' | 'warn';
    /** The folder, relative to the root; the root is `.`. */
    readonly folder: string;
    readonly message: string;
    readonly key: string | undefined;
    readonly measured: number;
    readonly limit: number | undefined;
    /** Paths relative to the root, sorted. */
    readonly files: readonly string[];
    readonly moves: readonly Move[];
    readonly url: string | undefined;
}

/** The numbers of one folder, for `--stats`. */
export interface FolderStat {
    readonly path: string;
    readonly modules: number;
    readonly files: number;
    readonly subfolders: number;
    /** The `max-files` limit in effect for the folder; `null` when that rule is off there. */
    readonly limit: number | null;
}

export interface EngineInput {
    /** File paths relative to the root, `/`-separated. */
    readonly files: readonly string[];
    readonly config: ResolvedConfig;
    /** Every rule that can be named: built-in and from plugins. */
    readonly rules: Readonly<Record<string, Rule>>;
    /**
     * When given, only folders equal to or under these are checked and counted; the files elsewhere are
     * left out before the tree is built, so one folder of a large repository is quick to check.
     */
    readonly only?: readonly string[];
    /** Also return the numbers of every folder reported on. */
    readonly stats?: boolean;
}

export interface EngineResult {
    readonly findings: readonly Finding[];
    readonly folderCount: number;
    readonly fileCount: number;
    /** Every folder reported on, when `stats` was asked for. */
    readonly folderStats?: readonly FolderStat[];
}

/** What `explain` shows about one folder: everything a rule would see, and why. */
export interface FolderExplanation {
    readonly folder: FolderView;
    readonly rules: Readonly<
        Record<string, RuleState & { readonly effectiveOptions: Readonly<Record<string, unknown>> }>
    >;
    readonly overrides: readonly OverrideState[];
    readonly findings: readonly Finding[];
}

/**
 * Filters the files by `include` and `exclude`. Both match a path or any folder above it:
 * `include: ["src"]` takes `src/a.ts`, as `exclude: ["src"]` would leave it out.
 */
export function selectFiles(files: readonly string[], config: Pick<ResolvedConfig, 'exclude' | 'include'>): string[] {
    const include = config.include.map(compileGlob);
    const exclude = config.exclude.map(compileGlob);
    return files.filter(
        file => (include.length === 0 || matchesSelfOrAncestor(file, include)) && !matchesSelfOrAncestor(file, exclude),
    );
}

/** Runs every rule that is on over every folder (or every folder under `only`). */
export function runEngine(input: EngineInput): EngineResult {
    const only = scopeOf(input.only);
    const files = selectFiles(inScope(filesOf(input.files), only), input.config);
    const tree = buildTree(files);
    const context = new FolderContext(input.config, input.rules);

    const findings: Finding[] = [];
    let folderCount = 0;
    const folderStats: FolderStat[] = [];
    for (const entry of tree) {
        if (only?.every(path => !isInside(entry.path, path))) {
            continue;
        }
        folderCount++;
        findings.push(...context.check(entry));
        if (input.stats) {
            folderStats.push(context.statsOf(entry));
        }
    }
    // Whether an override matches no folder is a question about the whole tree: a run over some
    // folders cannot answer it.
    if (!only) {
        findings.push(...context.unusedOverrideFindings());
    }
    return {
        findings: sortFindings(findings),
        folderCount,
        fileCount: files.length,
        ...(input.stats && { folderStats }),
    };
}

/** Everything about one folder; `undefined` when no selected file lives in or under it. */
export function explainFolder(input: EngineInput, path: string): FolderExplanation | undefined {
    const tree = buildTree(selectFiles(inScope(filesOf(input.files), scopeOf([path])), input.config));
    const entry = tree.find(candidate => candidate.path === path);
    if (!entry) {
        return undefined;
    }
    const context = new FolderContext(input.config, input.rules);
    const { naming, rules, overrides } = context.settingsFor(entry.path);
    const effective: Record<string, RuleState & { effectiveOptions: Readonly<Record<string, unknown>> }> = {};
    for (const [name, state] of Object.entries(rules)) {
        const rule = input.rules[name];
        effective[name] = {
            ...state,
            effectiveOptions: rule
                ? mergeOptions(rule.meta.defaultOptions as Record<string, unknown>, state.options)
                : state.options,
        };
    }
    return {
        folder: context.viewOf(entry, naming),
        rules: effective,
        overrides,
        findings: context.check(entry),
    };
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
    return findings.toSorted(
        (a, b) =>
            compareText(a.folder, b.folder) || compareText(a.rule, b.rule) || compareText(a.key ?? '', b.key ?? ''),
    );
}

interface CompiledOverride {
    readonly state: OverrideState;
    readonly globs: readonly Glob[];
    used: boolean;
}

/** The settings of each folder, with the work that repeats between folders done once. */
class FolderContext {
    private readonly config: ResolvedConfig;
    private readonly rules: Readonly<Record<string, Rule>>;
    private readonly overrides: CompiledOverride[];
    private readonly namingCache = new Map<string, Naming>();

    constructor(config: ResolvedConfig, rules: Readonly<Record<string, Rule>>) {
        this.config = config;
        this.rules = rules;
        this.overrides = config.overrides.map(state => ({ state, globs: state.folders.map(compileGlob), used: false }));
    }

    settingsFor(path: string): { naming: NamingState; rules: Record<string, RuleState>; overrides: OverrideState[] } {
        let naming = this.config.naming;
        const rules: Record<string, RuleState> = { ...this.config.rules };
        const applied: OverrideState[] = [];
        for (const override of this.overrides) {
            if (override.globs.every(glob => !glob.test(path))) {
                continue;
            }
            override.used = true;
            applied.push(override.state);
            naming = mergeNaming(naming, override.state.naming);
            for (const [name, setting] of Object.entries(override.state.rules)) {
                rules[name] = applySetting(rules[name], setting);
            }
        }
        return { naming, rules, overrides: applied };
    }

    viewOf(entry: FolderEntry, state: NamingState): FolderView {
        const naming = this.compileNaming(state);
        return { ...entry, naming, modules: modulesOf(entry.files, naming) };
    }

    statsOf(entry: FolderEntry): FolderStat {
        const { naming, rules } = this.settingsFor(entry.path);
        const state = rules['max-files'];
        const rule = this.rules['max-files'];
        const max =
            state && rule && state.severity !== 'off'
                ? mergeOptions(rule.meta.defaultOptions as Record<string, unknown>, state.options)['max']
                : undefined;
        return {
            path: entry.path,
            modules: this.viewOf(entry, naming).modules.length,
            files: entry.files.length,
            subfolders: entry.folders.length,
            limit: typeof max === 'number' ? max : null,
        };
    }

    check(entry: FolderEntry): Finding[] {
        const { naming, rules } = this.settingsFor(entry.path);
        const active = Object.entries(rules).filter(([, state]) => state.severity !== 'off');
        if (active.length === 0) {
            return [];
        }
        const view = this.viewOf(entry, naming);
        const findings: Finding[] = [];
        for (const [name, state] of active) {
            const rule = this.rules[name];
            if (!rule) {
                continue;
            }
            const options = mergeOptions(rule.meta.defaultOptions as Record<string, unknown>, state.options);
            const report = (problem: Problem): void => {
                findings.push(
                    toFinding(name, state.severity === 'warn' ? 'warn' : 'error', entry.path, problem, rule.meta.url),
                );
            };
            rule.check(view, { options, report });
        }
        return findings;
    }

    unusedOverrideFindings(): Finding[] {
        return this.overrides
            .filter(override => override.state.own && !override.used)
            .map(override => ({
                rule: 'config/unused-override',
                severity: 'warn' as const,
                folder: '.',
                message: `The override for ${override.state.folders.map(glob => `"${glob}"`).join(', ')} in ${override.state.origin} matches no folder ("${override.state.reason}"): remove it, or fix its globs.`,
                key: override.state.folders.join(','),
                measured: 1,
                limit: 0,
                files: [],
                moves: [],
                url: undefined,
            }));
    }

    private compileNaming(state: NamingState): Naming {
        const id = JSON.stringify(state);
        const cached = this.namingCache.get(id);
        if (cached) {
            return cached;
        }
        const naming: Naming = {
            companions: state.companions.map(pattern => new RegExp(pattern, 'u')),
            ignoreLeadingWords: new Set(state.ignoreLeadingWords),
            groupNumericPrefixes: state.groupNumericPrefixes,
        };
        this.namingCache.set(id, naming);
        return naming;
    }
}

/** The file paths, read the way the command reads them (`./a`, `a\b`); a path outside the root is an error. */
function filesOf(paths: readonly string[]): readonly string[] {
    const { files, problems } = normaliseFileList(paths);
    if (problems.length > 0) {
        throw new FileListError(problems);
    }
    return files;
}

/** The folders of `only`, or `undefined` when they cover the whole tree. */
function scopeOf(only: readonly string[] | undefined): string[] | undefined {
    const folders = only?.map(path => (path === '' ? '.' : path));
    return folders === undefined || folders.includes('.') ? undefined : folders;
}

function inScope(files: readonly string[], only: readonly string[] | undefined): readonly string[] {
    return only ? files.filter(file => only.some(path => file.startsWith(`${path}/`))) : files;
}

function isInside(folder: string, path: string): boolean {
    return folder === path || folder.startsWith(`${path}/`);
}

function toFinding(
    rule: string,
    severity: 'error' | 'warn',
    folder: string,
    problem: Problem,
    url: string | undefined,
): Finding {
    return {
        rule,
        severity,
        folder,
        message: problem.message,
        key: problem.key,
        measured: problem.measured ?? 1,
        limit: problem.limit,
        files: (problem.files ?? []).map(name => joinPath(folder, name)).toSorted(compareText),
        moves: problem.moves ?? [],
        url,
    };
}
