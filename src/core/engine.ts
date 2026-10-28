import { applySetting, mergeNaming, mergeOptions } from './config/merge.ts';
import type { NamingState, OverrideState, ResolvedConfig, RuleState } from './config/types.ts';
import { compareText, type Naming, readFolder } from './naming/modules.ts';
import { compileGlob, type Glob, PathMatcher } from './paths/glob.ts';
import { FileListError, normaliseFileList } from './paths/input.ts';
import { buildTree, type FolderEntry, joinPath } from './paths/tree.ts';
import type { FolderView, Move, Note, Problem, Rule, RuleContext } from './rules/rule.ts';

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
    /** `YYYY-MM-DD`, what `expires` of an override is compared with. Default: today, in UTC. */
    readonly today?: string;
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
    /** What the rules looked at and chose not to report, with why. */
    readonly notes: readonly RuleNote[];
}

/** A note of one rule, for `explain`. */
export interface RuleNote extends Note {
    readonly rule: string;
}

/**
 * Filters the files by `include` and `exclude`. Both match a path or any folder above it:
 * `include: ["src"]` takes `src/a.ts`, as `exclude: ["src"]` would leave it out.
 */
export function selectFiles(files: readonly string[], config: Pick<ResolvedConfig, 'exclude' | 'include'>): string[] {
    const include = new PathMatcher(config.include.map(compileGlob));
    const exclude = new PathMatcher(config.exclude.map(compileGlob));
    return files.filter(
        file => (include.isEmpty || include.matchesSelfOrAncestor(file)) && !exclude.matchesSelfOrAncestor(file),
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
    // An expired override is due wherever it applies: a run over some folders reports the ones it used.
    findings.push(...context.expiredOverrideFindings(input.today ?? todayInUtc(), only === undefined));
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
    const { naming, rules, overrides } = context.settingsFor(entry);
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
    const notes: RuleNote[] = [];
    return {
        folder: context.viewOf(entry, naming),
        rules: effective,
        overrides,
        findings: context.check(entry, notes),
        notes,
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
    readonly withFiles: readonly Glob[];
    used: boolean;
}

/**
 * The overrides that can match a folder, without trying each: a glob that spells out its folders
 * (`packages/a/**`) is filed under them, one that starts with `**\/name` under that name, and only
 * the rest (`*\/src`, `**`) is tried everywhere. A monorepo with an override per package then costs
 * about the same with 4 000 overrides as with 100. The candidates come back in the configuration's
 * order, which is the order they apply in.
 */
class OverrideIndex {
    private readonly byPrefix = new Map<string, number[]>();
    private readonly bySegment = new Map<string, number[]>();
    private readonly everywhere: number[] = [];
    private readonly overrides: readonly CompiledOverride[];

    constructor(overrides: readonly CompiledOverride[]) {
        this.overrides = overrides;
        const file = (map: Map<string, number[]>, key: string, index: number): void => {
            const list = map.get(key) ?? [];
            if (list.at(-1) !== index) {
                list.push(index);
            }
            map.set(key, list);
        };
        for (const [index, override] of overrides.entries()) {
            for (const glob of override.globs) {
                if (glob.prefix !== '') {
                    file(this.byPrefix, glob.prefix, index);
                } else if (glob.segment === undefined) {
                    if (this.everywhere.at(-1) !== index) this.everywhere.push(index);
                } else {
                    file(this.bySegment, glob.segment, index);
                }
            }
        }
    }

    candidatesFor(path: string): CompiledOverride[] {
        const found = new Set<number>(this.everywhere);
        const segments = path.split('/');
        let prefix = '';
        for (const segment of segments) {
            prefix = prefix === '' ? segment : `${prefix}/${segment}`;
            for (const index of this.byPrefix.get(prefix) ?? []) found.add(index);
            for (const index of this.bySegment.get(segment) ?? []) found.add(index);
        }
        return [...found].toSorted((a, b) => a - b).flatMap(index => this.overrides[index] ?? []);
    }
}

/** The settings of each folder, with the work that repeats between folders done once. */
class FolderContext {
    private readonly config: ResolvedConfig;
    private readonly rules: Readonly<Record<string, Rule>>;
    private readonly overrides: CompiledOverride[];
    private readonly index: OverrideIndex;
    private readonly namingCache = new Map<string, Naming>();

    constructor(config: ResolvedConfig, rules: Readonly<Record<string, Rule>>) {
        this.config = config;
        this.rules = rules;
        this.overrides = config.overrides.map(state => ({
            state,
            globs: state.folders.map(compileGlob),
            withFiles: state.withFiles.map(compileGlob),
            used: false,
        }));
        this.index = new OverrideIndex(this.overrides);
    }

    settingsFor(entry: Pick<FolderEntry, 'files' | 'path'>): {
        naming: NamingState;
        rules: Record<string, RuleState>;
        overrides: OverrideState[];
    } {
        let naming = this.config.naming;
        const rules: Record<string, RuleState> = { ...this.config.rules };
        const applied: OverrideState[] = [];
        for (const override of this.index.candidatesFor(entry.path)) {
            if (
                override.globs.every(glob => !glob.test(entry.path)) ||
                (override.withFiles.length > 0 &&
                    entry.files.every(file => override.withFiles.every(glob => !glob.test(file))))
            ) {
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
        const { modules, uncounted } = readFolder(entry.files, naming, entry.folders);
        return { ...entry, naming, modules, uncounted };
    }

    statsOf(entry: FolderEntry): FolderStat {
        const { naming, rules } = this.settingsFor(entry);
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

    /** Runs the rules on one folder; with `notes`, also collects what they chose not to report. */
    check(entry: FolderEntry, notes?: RuleNote[]): Finding[] {
        const { naming, rules } = this.settingsFor(entry);
        const active = Object.entries(rules).filter(([, state]) => state.severity !== 'off');
        if (active.length === 0) {
            return [];
        }
        const view = this.viewOf(entry, naming);
        const settingsOf: RuleContext<object>['settingsOf'] = other => {
            const state = rules[other];
            const rule = this.rules[other];
            if (!state || !rule || state.severity === 'off') {
                return;
            }
            return {
                severity: state.severity,
                options: mergeOptions(rule.meta.defaultOptions as Record<string, unknown>, state.options),
            };
        };
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
            // Only `explain` asks for notes; a normal run does not spend time writing them.
            const note = notes
                ? (found: Note): void => {
                      notes.push({ rule: name, ...found });
                  }
                : undefined;
            rule.check(view, { options, report, settingsOf, ...(note && { note }) });
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

    /**
     * The overrides of the user's own files whose `expires` is before `today`. They still apply (a
     * date must not turn a build red on its own), and say they are due: renew the date, or remove them.
     */
    expiredOverrideFindings(today: string, wholeTree: boolean): Finding[] {
        return this.overrides
            .filter(
                override =>
                    override.state.own &&
                    override.state.expires !== undefined &&
                    override.state.expires < today &&
                    (wholeTree || override.used),
            )
            .map(({ state }) => {
                const who = [
                    state.owner === undefined ? undefined : `owner ${state.owner}`,
                    state.ticket === undefined ? undefined : `ticket ${state.ticket}`,
                ].filter(part => part !== undefined);
                return {
                    rule: 'config/expired-override',
                    severity: 'warn' as const,
                    folder: '.',
                    message: `The override for ${state.folders.map(glob => `"${glob}"`).join(', ')} in ${state.origin} expired on ${state.expires ?? ''}${who.length > 0 ? ` (${who.join(', ')})` : ''}: "${state.reason}". It still applies: review it, then renew "expires" or remove it.`,
                    key: state.folders.join(','),
                    measured: 1,
                    limit: 0,
                    files: [],
                    moves: [],
                    url: undefined,
                };
            });
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
            folderFiles: state.folderFiles.map(compileGlob),
            folderCompanions: state.folderCompanions,
        };
        this.namingCache.set(id, naming);
        return naming;
    }
}

function todayInUtc(): string {
    return new Date().toISOString().slice(0, 10);
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
