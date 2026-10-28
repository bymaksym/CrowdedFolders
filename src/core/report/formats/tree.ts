import { plural } from '../../plural.ts';
import { asciiProse, wrapWords } from '../ascii.ts';
import type { Report } from '../report.ts';
import { safe } from '../sanitize.ts';
import {
    buildFolderTree,
    describeHealth,
    describeHidden,
    flatten,
    healthOf,
    type Level,
    type TreeFilter,
    treeRows,
} from '../tree/folder-tree.ts';
import { describeTiny } from '../tree/tiny.ts';
import { describeComparison } from '../tree/trial.ts';

export interface TreeTextOptions extends TreeFilter {
    readonly color: boolean;
    /** `false`: ASCII for the branches and the bar (a pipe, `TERM=dumb`, a screen reader). Default: symbols. */
    readonly symbols?: boolean;
    /** The columns of the terminal, to wrap the lines below the tree; left out for a pipe. */
    readonly width?: number | undefined;
    /** What to type for this command in the tips. */
    readonly command?: string | undefined;
}

/** The width of the bar, in characters. */
const BAR = 10;

const PAINT: Readonly<Record<Level, readonly [number, number]>> = {
    ok: [32, 39],
    near: [33, 39],
    over: [31, 39],
    none: [2, 22],
};

/** The words for each level: what a person without colours (or without sight of them) reads. */
const WORDS: Readonly<Record<Level, string>> = {
    ok: 'ok',
    near: 'near the limit',
    over: 'over the limit',
    none: 'no limit',
};

/**
 * The folders as a tree: each with its modules over its limit, a bar and a word (`ok`, `near the limit`,
 * `over the limit`), so that colour is never the only thing that says it. Folders under the depth are
 * folded into their parent's line, which says how many there are and how many are over.
 */
export function formatTreeText(report: Pick<Report, 'folderStats' | 'tinyFiles'>, options: TreeTextOptions): string {
    const symbols = options.symbols !== false;
    const say = (text: string): string => (symbols ? text : asciiProse(text));
    const paint = (code: readonly [number, number], text: string): string =>
        options.color ? `\u{1B}[${code[0]}m${text}\u{1B}[${code[1]}m` : text;
    const stats = report.folderStats ?? [];
    const roots = buildFolderTree(stats);
    if (roots.length === 0) {
        return `${say('No folders to show.')}\n`;
    }
    const rows = treeRows(roots, options);
    const branch = symbols
        ? { tee: '├─ ', end: '└─ ', bar: '│  ', gap: ' '.repeat(3) }
        : { tee: '|- ', end: '`- ', bar: '|  ', gap: ' '.repeat(3) };
    const labels = rows.map(row => {
        const trail = row.trail.map(more => (more ? branch.bar : branch.gap)).join('');
        const joint = row.depth === 0 ? '' : row.last ? branch.end : branch.tee;
        const name = row.depth === 0 ? row.node.path : row.node.name;
        return `${trail}${joint}${safe(name)}${name === '.' ? '' : '/'}`;
    });
    const labelWidth = Math.min(60, Math.max(0, ...labels.map(label => label.length)));
    const countWidth = Math.max(0, ...rows.map(row => countOf(row.node.stat.used, row.node.stat.limit).length));
    const lines: string[] = [];
    for (const [index, row] of rows.entries()) {
        const { node } = row;
        const label = labels[index] ?? '';
        const count = countOf(node.stat.used, node.stat.limit).padStart(countWidth);
        const bar = barOf(node.ratio, symbols);
        const hidden = describeHidden(row.hidden);
        lines.push(
            `${label}${' '.repeat(Math.max(2, labelWidth - label.length + 2))}${paint(PAINT[node.level], `${count}  ${bar}  ${WORDS[node.level]}`)}${hidden === '' ? '' : paint(PAINT.none, `  (${say(hidden)})`)}`,
        );
        const tiny = report.tinyFiles?.[node.path];
        if (tiny === undefined || node.level !== 'over') {
            continue;
        }
        const indent = ' '.repeat(row.trail.length * 3 + (row.depth === 0 ? 0 : 3));
        lines.push(`${indent}${paint(PAINT.none, `note: ${say(describeTiny(tiny))}`)}`);
    }

    lines.push('', ...footer(report, options, say));
    return `${lines.join('\n')}\n`;
}

const countOf = (used: number, limit: number | null): string => (limit === null ? String(used) : `${used}/${limit}`);

/** A bar of the share of the limit used: full at the limit, and over it a mark at the end. */
function barOf(ratio: number | null, symbols: boolean): string {
    if (ratio === null) {
        return symbols ? '·'.repeat(BAR) : '-'.repeat(BAR);
    }
    const filled = Math.min(BAR, Math.round(ratio * BAR));
    const [on, off] = symbols ? ['█', '░'] : ['#', '.'];
    return `${on.repeat(filled)}${off.repeat(BAR - filled)}${ratio > 1 ? '+' : ' '}`;
}

function footer(
    report: Pick<Report, 'folderStats'>,
    options: TreeTextOptions,
    say: (text: string) => string,
): string[] {
    const stats = report.folderStats ?? [];
    const all = flatten(buildFolderTree(stats));
    const health = healthOf(stats);
    const over = all.filter(node => node.level === 'over');
    const near = all.filter(node => node.level === 'near');
    const parts = [plural(all.length, 'folder')];
    if (health !== undefined) {
        parts.push(describeHealth(health));
    }
    parts.push(`${over.length} over the limit`, `${near.length} near it`);
    const lines = wrapWords(say(`${parts.join('; ')}.`), options.width, 0, 0);
    const biggest = over.toSorted((a, b) => b.stat.modules - a.stat.modules || (a.path < b.path ? -1 : 1))[0];
    const comparison = biggest === undefined ? undefined : describeComparison(biggest.stat.modules);
    if (biggest !== undefined && comparison !== undefined) {
        lines.push(...wrapWords(say(`The biggest, ${safe(biggest.path)}: ${comparison}`), options.width, 0, 2));
    }
    return lines;
}
