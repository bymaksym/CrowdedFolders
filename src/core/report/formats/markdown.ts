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
    lines.push('| Folder | Rule | Problem |', '| --- | --- | --- |');
    let size = lines.join('\n').length;
    let shown = 0;
    for (const finding of sorted) {
        const rule = finding.url ? `[${escapeText(finding.rule)}](${finding.url})` : escapeText(finding.rule);
        const row = `| ${codeSpan(folderLabel(finding.folder))} | ${rule} | ${escapeText(plainMessage(report, finding))} |`;
        if (shown >= shownOf(sorted.length, maxFindings) || size + row.length + 1 > BUDGET) {
            break;
        }
        lines.push(row);
        size += row.length + 1;
        shown++;
    }
    if (shown < sorted.length) {
        lines.push(
            '',
            `_… and ${plural(sorted.length - shown, 'more problem')} (the ${shown} worst are listed; \`--max-findings\` changes that, \`--format json\` has them all)._`,
        );
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
