import type { StaleSuppression } from '../suppressions.ts';
import { asciiProse, wrapWords } from './ascii.ts';
import { type GroupBy, groupFindings, overview } from './context/group.ts';
import { hyperlink, ruleFooter } from './context/links.ts';
import { plainMessage, staleReason } from './describe.ts';
import { moveLines, quoteSh } from './formats/moves.ts';
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
    /** `--quiet`: the problems and the summary, no tips. The summary says how many warnings it hid. */
    readonly quiet?: boolean;
    /**
     * The columns of the terminal: a finding longer than this goes on in the lines below, indented under
     * its message. Left out, nothing is wrapped (a pipe, a file).
     */
    readonly width?: number;
    /** `false`: words instead of ✖ ⚠ ✔ — → … (a pipe, `TERM=dumb`, a screen reader). Default: symbols. */
    readonly symbols?: boolean;
    /** What to type for this command in the tips: `npx crowded-folders` when it was run through npx. */
    readonly command?: string;
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
    const symbols = options.symbols !== false;
    const say = (text: string): string => (symbols ? text : asciiProse(text));
    const words = { error: symbols ? '✖ error' : 'error', warn: symbols ? '⚠ warn ' : 'warn ' };

    const grouping = options.groupBy ?? 'folder';
    const groups = groupFindings(report.findings, grouping);
    if (grouping !== 'folder') {
        lines.push(
            ...overview(groups, grouping === 'project' ? 'projects' : 'owners').map(line => paint('dim', say(line))),
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
            const mark = finding.severity === 'error' ? paint('red', words.error) : paint('yellow', words.warn);
            const url = urls.get(finding.rule);
            const name = finding.rule.padEnd(ruleWidth);
            const rule = options.hyperlinks && url !== undefined ? hyperlink(name, url) : name;
            const where =
                grouping === 'folder' ? '' : `${safe(finding.folder === '.' ? 'the root' : finding.folder)}: `;
            // What is already written on the line, so that a message that goes on starts under itself.
            const lead = 2 + words.error.length + 2 + ruleWidth + 2 + where.length;
            const hanging = lead > (options.width ?? 80) / 2 ? 6 : lead;
            const [first = '', ...more] = wrapWords(
                say(safe(plainMessage(report, finding))),
                options.width,
                lead,
                hanging,
            );
            lines.push(
                `  ${mark}  ${paint('dim', rule)}  ${where}${first}`,
                ...more.map(line => `${' '.repeat(hanging)}${line}`),
            );
            if (options.moves) {
                lines.push(
                    ...moveLines(report, finding).map(
                        line => `${' '.repeat(4 + words.error.length)}${paint('dim', safe(line))}`,
                    ),
                );
            }
        }
    }

    const firstFolder = groups
        .flatMap(group => group.findings)
        .find(finding => !finding.rule.startsWith('config/'))?.folder;
    pushStale(lines, report.staleSuppressions, paint, symbols);
    pushSummary(lines, report, { ...options, symbols }, paint, firstFolder);
    if (!options.hyperlinks && !options.quiet) {
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
function pushStale(lines: string[], stale: readonly StaleSuppression[], paint: Paint, symbols: boolean): void {
    const progress = stale.filter(entry => entry.status === 'lowered');
    const other = stale.filter(entry => entry.status !== 'lowered');
    if (progress.length > 0) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(paint('bold', 'Progress'));
        for (const entry of progress) {
            lines.push(
                `  ${paint('green', symbols ? '↓' : 'down')} ${safe(entry.folder)}  ${safe(entry.id)}  ${entry.count} ${symbols ? '→' : 'to'} ${paint('green', String(entry.measured))}`,
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
        const fixed = entry.status === 'fixed';
        const mark = fixed ? paint('green', symbols ? '✔' : 'fixed') : paint('red', symbols ? '✖' : 'stale');
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
function pushSummary(
    lines: string[],
    report: Report,
    options: TextOptions,
    paint: Paint,
    firstFolder = '<folder>',
): void {
    const totals = totalsOf(report.findings);
    const failed = exitCodeOf(report) === 1;
    const hidden = report.hiddenWarnings ?? 0;
    const over = isOverMaxWarnings(report);
    const symbols = options.symbols !== false;
    const say = (text: string): string => (symbols ? text : asciiProse(text));

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
        // With --quiet the warnings are not shown, so "0 warnings" would be false: they are counted as hidden.
        const counts = options.quiet
            ? `${plural(totals.errors, 'error')} in ${plural(totals.folders, 'folder')}`
            : `${plural(totals.errors, 'error')}, ${plural(totals.warnings, 'warning')} in ${plural(totals.folders, 'folder')}`;
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
        const ok = symbols ? '✔' : 'OK';
        pushWrapped(
            lines,
            `${paint('green', ok)} `,
            ok.length + 1,
            `${hidden > 0 ? 'No errors' : 'No crowded folders'}${suffix}`,
            options.width,
        );
        if (!options.quiet && report.closest && report.closest.length > 0) {
            const nearest = report.closest.map(item => `${safe(item.folder)} ${item.count}/${item.limit}`);
            pushWrapped(
                lines,
                '  ',
                2,
                paint('dim', say(`closest to the limit: ${nearest.join(', ')}`)),
                options.width,
            );
        }
        return;
    }
    const word = failed ? 'FAIL' : 'WARN';
    const mark = symbols ? (failed ? '✖' : '⚠') : word;
    pushWrapped(
        lines,
        `${paint(failed ? 'red' : 'yellow', mark)} `,
        mark.length + 1,
        `${parts.join('; ')}${suffix}`,
        options.width,
    );
    if (options.quiet) {
        return;
    }
    const command = options.command ?? 'crowded-folders';
    const tip = `--moves prints where each file could go; \`${command} explain ${quoteSh(safe(firstFolder))}\` shows how a folder was read.`;
    if (!options.moves && report.findings.some(finding => finding.moves.length > 0)) {
        pushWrapped(lines, '  ', 2, say(tip), options.width, 4, text => paint('dim', text));
    }
}

/** A line with its lead (already painted, `leadWidth` columns) and a text that goes on, indented, when it is too long. */
function pushWrapped(
    lines: string[],
    lead: string,
    leadWidth: number,
    text: string,
    width: number | undefined,
    hanging = leadWidth,
    style: (text: string) => string = line => line,
): void {
    const [first = '', ...more] = wrapWords(text, width, leadWidth, hanging);
    lines.push(`${lead}${style(first)}`, ...more.map(line => `${' '.repeat(hanging)}${style(line)}`));
}
