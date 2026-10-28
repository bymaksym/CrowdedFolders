import { applySetting, mergeNaming, mergeOptions } from './config/merge.ts';
import type { NamingState, OverrideState, ResolvedConfig, RuleState } from './config/types.ts';
import {
    type EngineInput,
    type EngineResult,
    type Finding,
    type FolderExplanation,
    type FolderStat,
    type RuleNote,
    sortFindings,
    toFinding,
} from './findings.ts';
import { counterpartsOf, foldMirrors } from './mirrors.ts';
import { type Naming, readFolder } from './naming/modules.ts';
import {
    type CompiledOverride,
    expiredOverrideFindings,
    OverrideIndex,
    todayInUtc,
    unusedOverrideFindings,
} from './overrides.ts';
import { compileGlob, PathMatcher } from './paths/glob.ts';
import { FileListError, normaliseFileList } from './paths/input.ts';
import { parseMirrors } from './paths/mirrors.ts';
import { buildTree, type FolderEntry, joinPath } from './paths/tree.ts';
import { callRule, frozenCopy, LATE_REPORT, ReadOnlySet, reportProblem, RuleError } from './rules/guard.ts';
import { folderStat } from './rules/max-files.ts';
import { caseless } from './rules/moves.ts';
import type { FolderView, Note, Problem, Rule, RuleContext, RuleVisitor, TreeProblem } from './rules/rule.ts';

export type { EngineInput, EngineResult, Finding, FolderExplanation, FolderStat } from './findings.ts';

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
    // A run over some folders also reads the trees that mirror them (naming.mirrors), so that a
    // problem folded into its mirror is folded the same way as in a run over everything.
    const mirrors = parseMirrors(input.config.naming.mirrors);
    const reach = only && [...only, ...only.flatMap(path => counterpartsOf(path, mirrors))];
    const all = selectFiles(inScope(filesOf(input.files), reach), input.config);
    const files = only ? inScope(all, only) : all;
    const tree = buildTree(all);
    const context = new FolderContext(input.config, input.rules, tree);

    let findings: Finding[] = [];
    let folderCount = 0;
    const folderStats: FolderStat[] = [];
    for (const entry of tree) {
        if (reach?.every(path => !isInside(entry.path, path))) {
            continue;
        }
        const counted = !only || only.some(path => isInside(entry.path, path));
        findings.push(...context.check(entry));
        if (!counted) {
            continue;
        }
        folderCount++;
        if (input.stats) {
            folderStats.push(context.statsOf(entry));
        }
    }
    findings.push(...context.finish());
    findings = foldMirrors(findings, context.mirrorTree());
    if (only) {
        findings = findings.filter(finding => only.some(path => isInside(finding.folder, path)));
    }
    // Whether an override matches no folder is a question about the whole tree: a run over some
    // folders cannot answer it.
    if (!only) {
        findings.push(...unusedOverrideFindings(context.overrides));
    }
    // An expired override is due wherever it applies: a run over some folders reports the ones it used.
    findings.push(...expiredOverrideFindings(context.overrides, input.today ?? todayInUtc(), only === undefined));
    return {
        findings: sortFindings(findings),
        folderCount,
        fileCount: files.length,
        ...(input.stats && { folderStats }),
    };
}

/** The folders each override applies to, for `crowded-folders overrides`. */
export interface OverrideCoverage {
    /** The folders checked (under `only`, when given). */
    readonly folderCount: number;
    /** Every override of the configuration, in order, with the folders it applies to. */
    readonly overrides: readonly { readonly state: OverrideState; readonly folders: readonly string[] }[];
}

export function overrideCoverage(input: EngineInput): OverrideCoverage {
    const only = scopeOf(input.only);
    const tree = buildTree(selectFiles(inScope(filesOf(input.files), only), input.config));
    const context = new FolderContext(input.config, input.rules, tree);
    const covered = new Map<OverrideState, string[]>(input.config.overrides.map(state => [state, []]));
    let folderCount = 0;
    for (const entry of tree) {
        if (only?.every(path => !isInside(entry.path, path))) {
            continue;
        }
        folderCount++;
        for (const state of context.settingsFor(entry).overrides) {
            covered.get(state)?.push(entry.path);
        }
    }
    return { folderCount, overrides: [...covered].map(([state, folders]) => ({ state, folders })) };
}

/** Everything about one folder; `undefined` when no selected file lives in or under it. */
export function explainFolder(input: EngineInput, path: string): FolderExplanation | undefined {
    const tree = buildTree(selectFiles(inScope(filesOf(input.files), scopeOf([path])), input.config));
    const entry = tree.find(candidate => candidate.path === path);
    if (!entry) {
        return undefined;
    }
    const context = new FolderContext(input.config, input.rules, tree);
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
    const findings = context.check(entry, notes);
    findings.push(...context.finish().filter(finding => finding.folder === path));
    return {
        folder: context.viewOf(entry, naming),
        rules: effective,
        overrides,
        findings: sortFindings(findings),
        notes,
    };
}

/** The settings of each folder, with the work that repeats between folders done once. */
class FolderContext {
    private readonly config: ResolvedConfig;
    private readonly rules: Readonly<Record<string, Rule>>;
    /** The configuration's overrides, compiled; `used` is set as folders match them. */
    readonly overrides: CompiledOverride[];
    private readonly index: OverrideIndex;
    private readonly namingCache = new Map<string, Naming>();
    /** The options of each rule for each state it is in, over its defaults and frozen: shared, never changed. */
    private readonly optionsCache = new Map<string, WeakMap<RuleState, Readonly<Record<string, unknown>>>>();
    /** What `create` returned, for the rules that have it, made on the first folder where each is on. */
    private readonly visitors = new Map<string, RuleVisitor>();
    /** What tree rules reported from `done`, kept until the end of the run. */
    private readonly treeProblems: { readonly rule: string; readonly problem: TreeProblem }[] = [];
    /** The folders checked, by path: where a tree rule may report. */
    private readonly visited = new Map<string, FolderEntry>();
    private readonly tree: readonly FolderEntry[];
    private folders: Map<string, FolderEntry> | undefined;
    private paths: Map<string, string> | undefined;

    constructor(config: ResolvedConfig, rules: Readonly<Record<string, Rule>>, tree: readonly FolderEntry[]) {
        this.config = config;
        this.rules = rules;
        this.tree = tree;
        this.overrides = config.overrides.map(state => ({
            state,
            globs: state.folders.map(compileGlob),
            withFiles: state.withFiles.map(compileGlob),
            within: state.within.map(compileGlob),
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
                (override.within.length > 0 && override.within.every(glob => !glob.test(entry.path))) ||
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

    /**
     * The folder as a rule sees it, frozen: every rule of the folder gets the same one, so a rule that
     * sorted `files` or pushed to `modules` would change what the next rule sees.
     */
    viewOf(entry: FolderEntry, state: NamingState): FolderView {
        const naming = this.compileNaming(state);
        const { modules, uncounted } = readFolder(entry.files, naming, entry.folders);
        for (const module of modules) {
            Object.freeze(module.files);
            Object.freeze(module.words);
            Object.freeze(module.subject);
            Object.freeze(module);
        }
        for (const item of uncounted) {
            Object.freeze(item);
        }
        return Object.freeze({
            ...entry,
            files: Object.freeze([...entry.files]),
            folders: Object.freeze([...entry.folders]),
            naming,
            modules: Object.freeze(modules),
            uncounted: Object.freeze(uncounted),
        });
    }

    /** The options of a rule in a state, over its defaults: frozen, and shared by every folder in that state. */
    optionsOf(name: string, rule: Rule, state: RuleState): Readonly<Record<string, unknown>> {
        let byState = this.optionsCache.get(name);
        if (!byState) {
            byState = new WeakMap();
            this.optionsCache.set(name, byState);
        }
        let options = byState.get(state);
        if (!options) {
            options = frozenCopy(mergeOptions(rule.meta.defaultOptions as Record<string, unknown>, state.options));
            byState.set(state, options);
        }
        return options;
    }

    statsOf(entry: FolderEntry): FolderStat {
        const { naming, rules } = this.settingsFor(entry);
        return folderStat(entry, this.viewOf(entry, naming), rules['max-files'], this.rules['max-files']);
    }

    /** Runs the rules on one folder; with `notes`, also collects what they chose not to report. */
    check(entry: FolderEntry, notes?: RuleNote[]): Finding[] {
        this.visited.set(entry.path, entry);
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
            return { severity: state.severity, options: this.optionsOf(other, rule, state) };
        };
        const findings: Finding[] = [];
        for (const [name, state] of active) {
            const rule = this.rules[name];
            if (!rule) {
                continue;
            }
            let isOpen = true;
            const report = (problem: Problem): void => {
                if (!isOpen) {
                    throw new RuleError(name, entry.path, LATE_REPORT);
                }
                const issue = reportProblem(problem);
                if (issue !== undefined) {
                    throw new RuleError(name, entry.path, issue);
                }
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
            const context = Object.freeze({
                options: this.optionsOf(name, rule, state),
                report,
                settingsOf,
                existing: this.existing,
                ...(note && { note }),
            });
            const visitor = rule.create ? this.visitorOf(name, rule) : undefined;
            callRule(name, entry.path, () =>
                visitor ? visitor.folder?.call(visitor, view, context) : rule.check?.(view, context),
            );
            isOpen = false;
        }
        return findings;
    }

    /**
     * Ends the run for the rules made with `create`: calls their `done`, then turns what they
     * reported into findings, each with the rule's severity in its folder (none where it is off).
     */
    finish(): Finding[] {
        for (const [name, visitor] of this.visitors) {
            if (visitor.done) {
                callRule(name, undefined, () => visitor.done?.call(visitor));
            }
        }
        this.visitors.clear();
        const findings: Finding[] = [];
        for (const { rule: name, problem } of this.treeProblems.splice(0)) {
            const entry = this.visited.get(problem.folder);
            const rule = this.rules[name];
            const state = entry && this.settingsFor(entry).rules[name];
            if (!state || !rule || state.severity === 'off') {
                continue;
            }
            const { folder, ...rest } = problem;
            findings.push(toFinding(name, state.severity === 'warn' ? 'warn' : 'error', folder, rest, rule.meta.url));
        }
        return findings;
    }

    /** What `create` returned for a rule, made the first time the rule is on in a folder. */
    private visitorOf(name: string, rule: Rule): RuleVisitor {
        const existing = this.visitors.get(name);
        if (existing) {
            return existing;
        }
        const report = (problem: TreeProblem): void => {
            const issue = reportProblem(problem);
            if (issue !== undefined) {
                throw new RuleError(name, undefined, issue);
            }
            if (!this.visited.has(problem.folder)) {
                throw new RuleError(
                    name,
                    undefined,
                    `report() named the folder ${JSON.stringify(problem.folder)}, which this run did not look at: a tree rule reports on the folders it was given`,
                );
            }
            this.treeProblems.push({ rule: name, problem });
        };
        let visitor: unknown;
        callRule(name, undefined, () => {
            visitor = rule.create?.(Object.freeze({ report }));
        });
        if (typeof visitor !== 'object' || visitor === null) {
            throw new RuleError(name, undefined, 'create() must return an object: { folder(view, context), done() }');
        }
        this.visitors.set(name, visitor);
        return visitor;
    }

    /**
     * The file or folder at a path as the tree writes it, compared without case: built the first
     * time a rule asks, which is when a move is planned.
     */
    readonly existing = (path: string): string | undefined => {
        if (!this.paths) {
            this.paths = new Map();
            for (const entry of this.tree) {
                this.paths.set(caseless(entry.path), entry.path);
                for (const file of entry.files) {
                    const full = joinPath(entry.path, file);
                    this.paths.set(caseless(full), full);
                }
            }
        }
        return this.paths.get(caseless(path));
    };

    /** The tree as folding the mirrors reads it. */
    mirrorTree(): Parameters<typeof foldMirrors>[1] {
        return {
            folder: path => {
                this.folders ??= new Map(this.tree.map(entry => [entry.path, entry]));
                return this.folders.get(path);
            },
            viewOf: entry => this.viewOf(entry, this.settingsFor(entry).naming),
            existing: this.existing,
        };
    }

    private compileNaming(state: NamingState): Naming {
        const id = JSON.stringify(state);
        const cached = this.namingCache.get(id);
        if (cached) {
            return cached;
        }
        // Frozen: every folder with the same naming shares this object.
        const naming: Naming = Object.freeze({
            companions: Object.freeze(state.companions.map(pattern => new RegExp(pattern, 'u'))),
            ignoreLeadingWords: new ReadOnlySet(state.ignoreLeadingWords),
            groupNumericPrefixes: state.groupNumericPrefixes,
            folderFiles: Object.freeze(state.folderFiles.map(glob => Object.freeze(compileGlob(glob)))),
            folderCompanions: Object.freeze([...state.folderCompanions]),
            folderCase: state.folderCase,
            reservedWords: new ReadOnlySet(state.reservedWords),
            keepInPlace: Object.freeze(state.keepInPlace.map(glob => Object.freeze(compileGlob(glob)))),
            routes: state.routes,
            groupFileStays: state.groupFileStays,
            mirrors: Object.freeze(parseMirrors(state.mirrors)),
        });
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
