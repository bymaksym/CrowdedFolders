import type { StaleSuppression } from '../suppressions.ts';
import { exitCodeOf, isOverMaxWarnings, plural, type Report, totalsOf } from './report.ts';

export interface TextOptions {
    readonly color: boolean;
    /** Print the suggested moves under each finding. */
    readonly moves: boolean;
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

    let folder: string | undefined;
    for (const finding of report.findings) {
        if (finding.folder !== folder) {
            if (folder !== undefined) {
                lines.push('');
            }
            folder = finding.folder;
            lines.push(paint('bold', folder === '.' ? '. (the root)' : `${folder}/`));
        }
        const mark = finding.severity === 'error' ? paint('red', '✖ error') : paint('yellow', '⚠ warn ');
        lines.push(`  ${mark}  ${paint('dim', finding.rule.padEnd(ruleWidth))}  ${finding.message}`);
        if (options.moves && finding.moves.length > 0) {
            for (const move of finding.moves) {
                lines.push(`           ${paint('dim', `git mv ${quote(move.from)} ${quote(move.to)}`)}`);
            }
        }
    }

    pushStale(lines, report.staleSuppressions, paint);
    pushSummary(lines, report, options, paint);
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
                `  ${paint('green', '↓')} ${entry.folder}  ${entry.id}  ${entry.count} → ${paint('green', String(entry.measured))}`,
            );
        }
        lines.push(
            `  Save it with ${paint('cyan', '--prune-suppressions')} and commit ${progress[0]?.file ?? 'the suppressions file'}: until then the run fails, so the number cannot climb back.`,
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
        lines.push(`  ${mark} ${entry.folder}  ${entry.id}  (suppressed at ${entry.count}; ${whyStale(entry)})`);
    }
    lines.push(`  Run with ${paint('cyan', '--prune-suppressions')} to remove them: the file only ever shrinks.`);
}

function whyStale(entry: StaleSuppression): string {
    switch (entry.status) {
        case 'unknown-rule': {
            return `"${entry.rule}" is not a rule`;
        }
        case 'missing-folder': {
            const hint = entry.didYouMean === undefined ? '' : `: did you mean ${entry.didYouMean}?`;
            return `the folder does not exist, or holds no checked file${hint}`;
        }
        case 'moved': {
            return `looks moved to ${entry.movedTo ?? '?'}: rename its key in ${entry.file} to keep it`;
        }
        case 'lowered': {
            return `now ${entry.measured ?? 0}`;
        }
        default: {
            return 'fixed';
        }
    }
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

function quote(path: string): string {
    return /^[\w./@+-]+$/u.test(path) ? path : `'${path.replaceAll("'", String.raw`'\''`)}'`;
}
