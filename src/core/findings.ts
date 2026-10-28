import type { OverrideState, ResolvedConfig, RuleState } from './config/types.ts';
import { compareText } from './naming/modules.ts';
import { joinPath } from './paths/tree.ts';
import type { FolderView, Move, Note, Problem, Rule } from './rules/rule.ts';

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
    /** What the rules looked at and chose not to report, with why. */
    readonly notes: readonly RuleNote[];
}

/** A note of one rule, for `explain`. */
export interface RuleNote extends Note {
    readonly rule: string;
}

/** A rule's problem in a folder as a finding: paths from the root, sorted. */
export function toFinding(
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
