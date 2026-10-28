import type { Finding, FolderStat } from '../engine.ts';

export type { FolderStat } from '../engine.ts';
import type { StaleSuppression } from '../suppressions.ts';

/** A finding with what the report adds to it: the project it belongs to and who owns it. */
export interface ReportFinding extends Finding {
    /**
     * The nearest folder, from the finding's folder upwards, that holds a project manifest
     * (`package.json`, `go.mod`…); `null` when none does. The root is `.`.
     */
    readonly project?: string | null;
    /** The CODEOWNERS owners of the folder, as written there (`@org/team`); empty when none matches. */
    readonly owners?: readonly string[];
}

/** One rule a report can name: the rules that are loaded plus the `config/*` ones the tool reports itself. */
export interface ReportRule {
    readonly id: string;
    readonly description: string;
    readonly url: string | undefined;
}

/** How the run read its input, for the formats that keep a record of the run. */
export interface RunInfo {
    /** The presets in effect, in order. */
    readonly presets: readonly string[];
    /** Whether they were found in the repository because there was no configuration file. */
    readonly presetsDetected: boolean;
    /** The configuration file, relative to the root; `null` when there is none. */
    readonly configFile: string | null;
    readonly fileSource: 'disk' | 'git' | 'stdin';
    /** The checked root, relative to where the command ran (`.` for the same folder); never absolute. */
    readonly root: string;
}

/** Everything an output format needs about one run. */
export interface Report {
    readonly tool: { readonly name: string; readonly version: string; readonly url: string };
    readonly findings: readonly ReportFinding[];
    readonly suppressedCount: number;
    readonly staleSuppressions: readonly StaleSuppression[];
    readonly folderCount: number;
    readonly fileCount: number;
    /** Rules, with their documentation, for formats that list rules (SARIF). */
    readonly rules: readonly ReportRule[];
    readonly run?: RunInfo;
    /** Set when the run could not be done (exit code 2): what went wrong, and in which file when known. */
    readonly failure?: { readonly message: string; readonly file?: string };
    /** The files that were checked, to find a stable file in a folder for formats that need a file. */
    readonly files?: readonly string[];
    /** Files this change adds (from `--base`), preferred as the place for a finding about their folder. */
    readonly addedFiles?: ReadonlySet<string>;
    /** The configuration file, relative to the root: where `config/*` findings are anchored. */
    readonly configFile?: string;
    /** Finding key → line of the override in the configuration file, when it could be found. */
    readonly overrideLines?: Readonly<Record<string, number>>;
    /**
     * The suppressions file, relative to the root: where stale suppressions are anchored when their
     * own `file` is outside it.
     */
    readonly suppressionsFile?: string;
    /** `folder\0id` → line of the suppression in its file, when it could be found. */
    readonly suppressionLines?: Readonly<Record<string, number>>;
    /** Absolute folders that must never appear in a message, and what replaces each. */
    readonly hide?: readonly { readonly dir: string; readonly as: string }[];
    /** Every folder with its numbers (`--stats`). */
    readonly folderStats?: readonly FolderStat[];
    /** Warnings `--quiet` left out of `findings`; they still count for `--max-warnings`. */
    readonly hiddenWarnings?: number;
    /** `--max-warnings`, when given. */
    readonly maxWarnings?: number;
    /**
     * With `--moves`: for each finding that moves files (`referencesKey`), the tracked files whose
     * text names one of the paths it moves, which the move would break. Found outside the core.
     */
    readonly references?: Readonly<Record<string, readonly string[]>>;
    /** With `--new-since`: the base, and how many problems it already had (they do not fail). */
    readonly knownOnBase?: { readonly label: string; readonly count: number };
}

export interface Totals {
    readonly errors: number;
    readonly warnings: number;
    readonly folders: number;
}

export function totalsOf(findings: readonly Finding[]): Totals {
    return {
        errors: findings.filter(finding => finding.severity === 'error').length,
        warnings: findings.filter(finding => finding.severity === 'warn').length,
        folders: new Set(findings.map(finding => finding.folder)).size,
    };
}

/**
 * The exit code of a check: 1 for an error, a stale suppression, or more warnings than
 * `--max-warnings` (hidden ones included); else 0. The text summary is written from the same
 * function, so it can never say "no problems" on a run that fails.
 */
export function exitCodeOf(report: Report): 0 | 1 {
    return totalsOf(report.findings).errors > 0 || report.staleSuppressions.length > 0 || isOverMaxWarnings(report)
        ? 1
        : 0;
}

/** Whether the warnings, those `--quiet` hid included, are more than `--max-warnings`. */
export function isOverMaxWarnings(report: Report): boolean {
    const warnings = totalsOf(report.findings).warnings + (report.hiddenWarnings ?? 0);
    return report.maxWarnings !== undefined && warnings > report.maxWarnings;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}
