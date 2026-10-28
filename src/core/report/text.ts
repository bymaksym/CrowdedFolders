import type { StaleSuppression } from '../suppressions.ts';
import { type GroupBy, groupFindings, overview } from './context/group.ts';
import { hyperlink, ruleFooter } from './context/links.ts';
import { plainMessage, staleReason } from './describe.ts';
import { moveLines } from './formats/moves.ts';
import { exitCodeOf, isOverMaxWarnings, plural, type Report, totalsOf } from './report.ts';
import { safe } from './sanitize.ts';

export interface TextOptions {
    readonly color: boolean;
    /** Print the suggested moves under each finding. */
    readonly moves: boolean;
    /** Make the rule names links (OSC 8), for a terminal; without it a footer lists the URLs. */
    readonly hyperlinks?: boolean;
    /** How the findings are grouped; default: by folder. */
    readonly groupBy?: GroupBy;
}

const CODES = {
    bold: [1, 22],
    dim: [2, 22],
    red: [31, 39],
    yellow: [33, 39],
    green: [32, 39],
    cyan: [36, 39],
} as const;

type Style = keyof typeof CODES;

/** The report for a person at a terminal: grouped by folder, the summary last. */
export function formatText(report: Report, options: TextOptions): string {
    const paint = (style: Style, text: string): string =>
        options.color ? `\u{1B}[${CODES[style][0]}m${text}\u{1B}[${CODES[style][1]}m` : text;
    const lines: string[] = [];
    const ruleWidth = Math.max(0, ...report.findings.map(finding => finding.rule.length));

    const grouping = options.groupBy ?? 'folder';
    const groups = groupFindings(report.findings, grouping);
    if (grouping !== 'folder') {
        lines.push(
            ...overview(groups, grouping === 'project' ? 'projects' : 'owners').map(line => paint('dim', line)),
            '',
        );
    }
    const urls = new Map(report.findings.map(finding => [finding.rule, finding.url] as const));
    for (const [index, group] of groups.entries()) {
        if (index > 0) {
            lines.push('');
        }
        lines.push(paint('bold', safe(group.title)));
        for (const finding of group.findings) {
            const mark = finding.severity === 'error' ? paint('red', '✖ error') : paint('yellow', '⚠ warn ');
            const url = urls.get(finding.rule);
            const name = finding.rule.padEnd(ruleWidth);
            const rule = options.hyperlinks && url !== undefined ? hyperlink(name, url) : name;
            const where =
                grouping === 'folder' ? '' : `${safe(finding.folder === '.' ? 'the root' : finding.folder)}: `;
            lines.push(`  ${mark}  ${paint('dim', rule)}  ${where}${safe(plainMessage(report, finding))}`);
            if (options.moves) {
                lines.push(...moveLines(report, finding).map(line => `           ${paint('dim', safe(line))}`));
            }
        }
    }

    pushStale(lines, report.staleSuppressions, paint);
    pushSummary(lines, report, options, paint);
    if (!options.hyperlinks) {
        const footer = ruleFooter(report.findings);
        if (footer.length > 0) {
            lines.push('', ...footer.map((line, index) => paint(index === 0 ? 'bold' : 'dim', line)));
        }
    }
    return `${lines.join('\n')}\n`;
}

type Paint = (style: Style, text: string) => string;

/**
 * Stale suppressions in two blocks: progress (a folder that went down but still needs its
 * suppression, in green: good news, to be saved) and the ones nothing needs, each saying why.
 */
function pushStale(lines: string[], stale: readonly StaleSuppression[], paint: Paint): void {
    const progress = stale.filter(entry => entry.status === 'lowered');
    const other = stale.filter(entry => entry.status !== 'lowered');
    if (progress.length > 0) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(paint('bold', 'Progress'));
        for (const entry of progress) {
            lines.push(
                `  ${paint('green', '↓')} ${safe(entry.folder)}  ${safe(entry.id)}  ${entry.count} → ${paint('green', String(entry.measured))}`,
            );
        }
        lines.push(
            `  Save it with ${paint('cyan', '--prune-suppressions')} and commit ${safe(progress[0]?.file ?? 'the suppressions file')}: until then the run fails, so the number cannot climb back.`,
        );
    }
    if (other.length === 0) {
        return;
    }
    if (lines.length > 0) {
        lines.push('');
    }
    lines.push(paint('bold', 'Suppressions nothing needs any more'));
    for (const entry of other) {
        const mark = entry.status === 'fixed' ? paint('green', '✔') : paint('red', '✖');
        lines.push(
            `  ${mark} ${safe(entry.folder)}  ${safe(entry.id)}  (suppressed at ${entry.count}; ${safe(staleReason(entry))})`,
        );
    }
    lines.push(`  Run with ${paint('cyan', '--prune-suppressions')} to remove them: the file only ever shrinks.`);
}

/**
 * The last line. Its mark and words follow the exit code (`exitCodeOf`): a run that fails never
 * ends in a green "No crowded folders", whatever made it fail.
 */
function pushSummary(lines: string[], report: Report, options: TextOptions, paint: Paint): void {
    const totals = totalsOf(report.findings);
    const failed = exitCodeOf(report) === 1;
    const hidden = report.hiddenWarnings ?? 0;
    const over = isOverMaxWarnings(report);

    const details = [`${plural(report.folderCount, 'folder')} and ${plural(report.fileCount, 'file')} checked`];
    if (report.suppressedCount > 0) {
        details.push(`${plural(report.suppressedCount, 'problem')} suppressed`);
    }
    if (report.knownOnBase && report.knownOnBase.count > 0) {
        details.push(`${plural(report.knownOnBase.count, 'problem')} already on ${report.knownOnBase.label}`);
    }
    if (hidden > 0 && !over) {
        details.push(`${plural(hidden, 'warning')} hidden by --quiet`);
    }

    const parts: string[] = [];
    const overText = `over --max-warnings ${report.maxWarnings ?? 0}`;
    if (totals.errors + totals.warnings > 0) {
        const counts = `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')} in ${plural(totals.folders, 'folder')}`;
        parts.push(over && hidden === 0 ? `${counts}, ${overText}` : counts);
    }
    if (over && hidden > 0) {
        parts.push(`${plural(totals.warnings + hidden, 'warning')} (${hidden} hidden by --quiet), ${overText}`);
    }
    if (report.staleSuppressions.length > 0) {
        parts.push(`${plural(report.staleSuppressions.length, 'suppression')} to prune`);
    }

    if (lines.length > 0) {
        lines.push('');
    }
    const suffix = ` (${details.join('; ')}).`;
    if (parts.length === 0) {
        lines.push(`${paint('green', '✔')} ${hidden > 0 ? 'No errors' : 'No crowded folders'}${suffix}`);
        return;
    }
    const mark = failed ? paint('red', '✖') : paint('yellow', '⚠');
    lines.push(`${mark} ${parts.join('; ')}${suffix}`);
    if (!options.moves && report.findings.some(finding => finding.moves.length > 0)) {
        lines.push(
            paint(
                'dim',
                '  --moves prints where each file could go; `crowded-folders explain <folder>` shows how a folder was read.',
            ),
        );
    }
}
