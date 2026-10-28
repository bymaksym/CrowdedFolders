import { type GroupBy, groupFindings, overview } from './context/group.ts';
import { hyperlink, ruleFooter } from './context/links.ts';
import { plainMessage } from './describe.ts';
import { plural, type Report, totalsOf } from './report.ts';
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
            if (options.moves && finding.moves.length > 0) {
                for (const move of finding.moves) {
                    lines.push(
                        `           ${paint('dim', `git mv ${quote(safe(move.from))} ${quote(safe(move.to))}`)}`,
                    );
                }
            }
        }
    }

    if (report.staleSuppressions.length > 0) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(paint('bold', 'Suppressions nothing needs any more'));
        for (const stale of report.staleSuppressions) {
            const now = stale.measured === undefined ? 'fixed' : `now ${stale.measured}`;
            lines.push(
                `  ${paint('red', '✖')} ${safe(stale.folder)}  ${safe(stale.id)}  (suppressed at ${stale.count}, ${now})`,
            );
        }
        lines.push(`  Run with ${paint('cyan', '--prune-suppressions')} to lower them: the file only ever shrinks.`);
    }

    const totals = totalsOf(report.findings);
    const checked = `${plural(report.folderCount, 'folder')} and ${plural(report.fileCount, 'file')} checked`;
    const suppressed = report.suppressedCount > 0 ? `; ${plural(report.suppressedCount, 'problem')} suppressed` : '';
    if (lines.length > 0) {
        lines.push('');
    }
    if (totals.errors + totals.warnings === 0) {
        lines.push(`${paint('green', '✔')} No crowded folders (${checked}${suppressed}).`);
    } else {
        const counts = `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')} in ${plural(totals.folders, 'folder')}`;
        const mark = totals.errors > 0 ? paint('red', '✖') : paint('yellow', '⚠');
        lines.push(`${mark} ${counts} (${checked}${suppressed}).`);
        if (!options.moves && report.findings.some(finding => finding.moves.length > 0)) {
            lines.push(
                paint(
                    'dim',
                    '  --moves prints where each file could go; `crowded-folders explain <folder>` shows how a folder was read.',
                ),
            );
        }
    }
    if (!options.hyperlinks) {
        const footer = ruleFooter(report.findings);
        if (footer.length > 0) {
            lines.push('', ...footer.map((line, index) => paint(index === 0 ? 'bold' : 'dim', line)));
        }
    }
    return `${lines.join('\n')}\n`;
}

function quote(path: string): string {
    return /^[\w./@+-]+$/u.test(path) ? path : `'${path.replaceAll("'", String.raw`'\''`)}'`;
}
