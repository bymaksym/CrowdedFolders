import type { Finding } from '../engine.ts';
import type { StaleSuppression } from '../suppressions.ts';

/** Everything an output format needs about one run. */
export interface Report {
    readonly tool: { readonly name: string; readonly version: string; readonly url: string };
    readonly findings: readonly Finding[];
    readonly suppressedCount: number;
    readonly staleSuppressions: readonly StaleSuppression[];
    readonly folderCount: number;
    readonly fileCount: number;
    /** Rules that were on, with their documentation, for formats that list rules (SARIF). */
    readonly rules: readonly { readonly id: string; readonly description: string; readonly url: string | undefined }[];
    /** Warnings `--quiet` left out of `findings`; they still count for `--max-warnings`. */
    readonly hiddenWarnings?: number;
    /** `--max-warnings`, when given. */
    readonly maxWarnings?: number;
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

/** The file a finding points at in formats that need one file: the first of its files, else the folder. */
export function anchorOf(finding: Finding): string {
    return finding.files[0] ?? finding.folder;
}
