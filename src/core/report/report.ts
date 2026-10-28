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
    /** The suppressions file, relative to the root: where stale suppressions are anchored. */
    readonly suppressionsFile?: string;
    /** `folder\0id` → line of the suppression in its file, when it could be found. */
    readonly suppressionLines?: Readonly<Record<string, number>>;
    /** Absolute folders that must never appear in a message, and what replaces each. */
    readonly hide?: readonly { readonly dir: string; readonly as: string }[];
    /** Every folder with its numbers (`--stats`). */
    readonly folderStats?: readonly FolderStat[];
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

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}
