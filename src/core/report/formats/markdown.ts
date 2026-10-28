import { findingId } from '../../changes.ts';
import { shownOf } from '../../plural.ts';
import { byWeight, describeStale, failureMessage, folderLabel, plainMessage } from '../describe.ts';
import { plural, type Report, type ReportFinding, totalsOf } from '../report.ts';
import { safe } from '../sanitize.ts';

export interface MarkdownOptions {
    /** How many findings to list; the rest become "and N more". Default: 200. */
    readonly maxFindings?: number;
}

export const DEFAULT_MAX_FINDINGS = 200;
/** GitHub cuts a job summary at 1 MiB; this leaves room for the lines around the table. */
const BUDGET = 900_000;
/** Characters Markdown reads as syntax inside a sentence or a table cell. */
const SPECIAL = new Set(['\\', '`', '*', '_', '[', ']', '|', '~']);
/** How many improvements a pull-request comment lists. */
const IMPROVED_SHOWN = 20;
/** How many groups the per-group summary lists. */
const TOP_GROUPS = 10;

/** A Markdown summary for a pull request comment or `$GITHUB_STEP_SUMMARY`. */
export function formatMarkdown(report: Report, options: MarkdownOptions = {}): string {
    const totals = totalsOf(report.findings);
    const lines = ['## crowded-folders', ''];
    if (report.failure) {
        const why = failureMessage(report, report.failure.message).replaceAll('\n', ' ');
        lines.push(`**crowded-folders could not run:** ${escapeText(why)}`);
        return `${lines.join('\n')}\n`;
    }
    if (report.findings.length === 0 && report.staleSuppressions.length === 0) {
        lines.push(
            `No crowded folders: ${plural(report.folderCount, 'folder')} and ${plural(report.fileCount, 'file')} checked.`,
        );
        return `${lines.join('\n')}\n`;
    }
    lines.push(
        `**${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')}** in ${plural(totals.folders, 'folder')} (${report.folderCount} checked).`,
        '',
        ...groupSummary(report.findings),
    );

    const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
    const sorted = report.findings.toSorted(byWeight);
    const table = new Table(report, maxFindings, lines.join('\n').length);
    if (report.change) {
        lines.push(...changeSections(report, report.change, sorted, table));
    } else {
        lines.push(...table.rows(sorted));
    }
    if (report.staleSuppressions.length > 0) {
        lines.push('', 'Suppressions nothing needs any more (run with `--prune-suppressions`):', '');
        const staleShown = shownOf(report.staleSuppressions.length, maxFindings);
        for (const stale of report.staleSuppressions.slice(0, staleShown)) {
            lines.push(`- ${escapeText(describeStale(stale))}`);
        }
        if (report.staleSuppressions.length > staleShown) {
            lines.push(`- _… and ${report.staleSuppressions.length - staleShown} more._`);
        }
    }
    return `${lines.join('\n')}\n`;
}

/**
 * The rows of the problems, sharing one budget: the worst `maxFindings` of each list, and never past
 * what GitHub takes (a job summary is cut at 1 MiB, a comment at 65 536 characters).
 */
class Table {
    private size: number;
    private readonly report: Report;
    private readonly maxFindings: number;

    constructor(report: Report, maxFindings: number, size: number) {
        this.report = report;
        this.maxFindings = maxFindings;
        this.size = size;
    }

    rows(findings: readonly ReportFinding[], before?: (finding: ReportFinding) => number | undefined): string[] {
        const lines = before
            ? ['| Folder | Rule | Before | Now | Problem |', '| --- | --- | ---: | ---: | --- |']
            : ['| Folder | Rule | Problem |', '| --- | --- | --- |'];
        let shown = 0;
        for (const finding of findings) {
            const rule = finding.url ? `[${escapeText(finding.rule)}](${finding.url})` : escapeText(finding.rule);
            const numbers = before ? ` ${before(finding) ?? ''} | ${finding.measured} |` : '';
            const row = `| ${codeSpan(folderLabel(finding.folder))} | ${rule} |${numbers} ${escapeText(plainMessage(this.report, finding))} |`;
            if (shown >= shownOf(findings.length, this.maxFindings) || this.size + row.length + 1 > BUDGET) {
                break;
            }
            lines.push(row);
            this.size += row.length + 1;
            shown++;
        }
        if (shown < findings.length) {
            lines.push(
                '',
                `_… and ${plural(findings.length - shown, 'more problem')} (the ${shown} worst are listed; \`--max-findings\` changes that, \`--format json\` has them all)._`,
            );
        }
        return lines;
    }
}

/**
 * For a pull request: what is new, what grew and what improved against the base, then what the base
 * already had, folded. A comment that lists 40 old problems under 1 new one hides the new one.
 */
function changeSections(
    report: Report,
    change: NonNullable<Report['change']>,
    sorted: readonly ReportFinding[],
    table: Table,
): string[] {
    const beforeOf = (finding: ReportFinding): number | undefined => change.before[findingId(finding)];
    const added = sorted.filter(finding => beforeOf(finding) === undefined);
    const grew = sorted.filter(finding => (beforeOf(finding) ?? Infinity) < finding.measured);
    const same = sorted.filter(finding => {
        const before = beforeOf(finding);
        return before !== undefined && before >= finding.measured;
    });
    const label = codeSpan(change.label);
    const lines = [
        `Against ${label}: **${added.length} new**, **${grew.length} grew**, ${change.improved.length} improved${same.length > 0 || (report.knownOnBase?.count ?? 0) > 0 ? `, ${same.length + (report.knownOnBase?.count ?? 0)} as they were` : ''}.`,
        '',
    ];
    if (added.length > 0) {
        lines.push(`### New (${added.length})`, '', ...table.rows(added), '');
    }
    if (grew.length > 0) {
        lines.push(`### Grew (${grew.length})`, '', ...table.rows(grew, beforeOf), '');
    }
    if (change.improved.length > 0) {
        lines.push(`### Improved (${change.improved.length})`, '');
        const shown = shownOf(change.improved.length, IMPROVED_SHOWN);
        for (const item of change.improved.slice(0, shown)) {
            const key = item.key === undefined ? '' : ` ${codeSpan(item.key)}`;
            const now = item.after === null ? 'gone' : `${item.before} → ${item.after}`;
            lines.push(`- ${codeSpan(folderLabel(item.folder))} ${escapeText(item.rule)}${key}: ${now}`);
        }
        if (change.improved.length > shown) {
            lines.push(`- _… and ${change.improved.length - shown} more._`);
        }
        lines.push('');
    }
    if (same.length > 0) {
        lines.push(
            '<details>',
            `<summary>As they were on ${escapeText(change.label)} (${same.length})</summary>`,
            '',
            ...table.rows(same),
            '',
            '</details>',
        );
    }
    while (lines.at(-1) === '') {
        lines.pop();
    }
    return lines;
}

/** Errors and warnings per project (or per top-level folder without projects), the worst first. */
function groupSummary(findings: readonly ReportFinding[]): string[] {
    const groups = new Map<string, { errors: number; warnings: number }>();
    for (const finding of findings) {
        const name = finding.project ?? finding.folder.split('/', 1)[0] ?? '.';
        const group = groups.get(name) ?? { errors: 0, warnings: 0 };
        if (finding.severity === 'error') group.errors++;
        else group.warnings++;
        groups.set(name, group);
    }
    if (groups.size < 2) {
        return [];
    }
    const top = [...groups].toSorted(
        ([nameA, a], [nameB, b]) => b.errors - a.errors || b.warnings - a.warnings || (nameA < nameB ? -1 : 1),
    );
    const lines = ['| Where | Errors | Warnings |', '| --- | ---: | ---: |'];
    for (const [name, group] of top.slice(0, TOP_GROUPS)) {
        lines.push(`| ${codeSpan(folderLabel(name))} | ${group.errors} | ${group.warnings} |`);
    }
    if (top.length > TOP_GROUPS) {
        lines.push(`| _… and ${top.length - TOP_GROUPS} more_ | | |`);
    }
    lines.push('');
    return lines;
}

/** A name as code: nothing in it is read as Markdown, a mention or HTML, and a backtick in it cannot end the span. */
function codeSpan(text: string): string {
    const clean = safe(text).replaceAll('|', String.raw`\|`);
    let longest = 0;
    for (const run of clean.matchAll(/`+/gu)) {
        longest = Math.max(longest, run[0].length);
    }
    const fence = '`'.repeat(longest + 1);
    return longest > 0 ? `${fence} ${clean} ${fence}` : `${fence}${clean}${fence}`;
}

/**
 * Text from a message or a file name, made inert: no HTML, no emphasis or links, and no mention or
 * issue reference (`@octocat` would notify a user, `#1` would link an issue; a zero-width space after
 * the character stops GitHub reading them, and a backslash would not).
 */
export function escapeText(text: string): string {
    let out = '';
    for (const character of safe(text)) {
        switch (character) {
            case '&': {
                out += '&amp;';
                break;
            }
            case '<': {
                out += '&lt;';
                break;
            }
            case '>': {
                out += '&gt;';
                break;
            }
            case '@':
            case '#': {
                out += `${character}&#8203;`;
                break;
            }
            default: {
                out += SPECIAL.has(character) ? `\\${character}` : character;
            }
        }
    }
    return out;
}
