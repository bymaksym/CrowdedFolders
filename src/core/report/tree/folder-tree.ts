import type { FolderStat } from '../../findings.ts';
import { plural } from '../../plural.ts';

/** How near a folder is to its limit, in words: what a terminal without colour prints, and the HTML says. */
export type Level = 'ok' | 'near' | 'over' | 'none';

/** From this share of its limit a folder is "near" it. The same figure `closest to the limit` uses. */
export const NEAR_FROM = 0.6;

/** The level of a folder: `none` when no limit applies to it. */
export function levelOf(used: number, limit: number | null): Level {
    if (limit === null || limit <= 0) {
        return 'none';
    }
    if (used > limit) {
        return 'over';
    }
    return used / limit >= NEAR_FROM ? 'near' : 'ok';
}

/** A folder with the folders below it, as the `tree` command and the HTML map see it. */
export interface FolderNode {
    /** From the root of the run; `.` is the root. */
    readonly path: string;
    readonly name: string;
    readonly stat: FolderStat;
    readonly level: Level;
    /** `used / limit`; `null` when there is no limit. */
    readonly ratio: number | null;
    /** The modules of the folder and of everything below it (at least 1): the area it gets on the map. */
    readonly weight: number;
    readonly children: readonly FolderNode[];
}

/** A folder that no stat names (it holds only folders, and the rule is off there): nothing to measure. */
function emptyStat(path: string): FolderStat {
    return { path, modules: 0, files: 0, subfolders: 0, limit: null, unit: 'modules', used: 0 };
}

const nameOf = (path: string): string => (path === '.' ? '.' : path.slice(path.lastIndexOf('/') + 1));

/**
 * The folders of a run as trees. A run over some folders has the stats of those only, so the result is a
 * forest: every folder whose parent is not in the list is a root. A folder whose parent is missing hangs
 * from its nearest ancestor that is there.
 */
export function buildFolderTree(stats: readonly FolderStat[]): FolderNode[] {
    const byPath = new Map(stats.map(stat => [stat.path, stat] as const));
    const childrenOf = new Map<string, string[]>();
    const roots: string[] = [];
    for (const { path } of stats) {
        const parent = nearestAncestor(path, byPath);
        if (parent === undefined) {
            roots.push(path);
        } else {
            const list = childrenOf.get(parent);
            if (list) list.push(path);
            else childrenOf.set(parent, [path]);
        }
    }
    // An iterative walk: a tree thousands of folders deep must not overflow the stack.
    const made = new Map<string, FolderNode>();
    const order: string[] = [];
    const pending = [...roots];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        order.push(next);
        pending.push(...(childrenOf.get(next) ?? []));
    }
    for (const path of order.toReversed()) {
        const stat = byPath.get(path) ?? emptyStat(path);
        const children = (childrenOf.get(path) ?? [])
            .map(child => made.get(child))
            .filter((child): child is FolderNode => child !== undefined)
            .toSorted(byNameThenPath);
        made.set(path, {
            path,
            name: nameOf(path),
            stat,
            level: levelOf(stat.used, stat.limit),
            ratio: stat.limit === null || stat.limit <= 0 ? null : stat.used / stat.limit,
            // A folder with nothing below it still gets room on the map, however few modules it holds.
            weight:
                children.length === 0
                    ? Math.max(1, stat.modules)
                    : stat.modules + children.reduce((sum, child) => sum + child.weight, 0),
            children,
        });
    }
    return roots
        .map(path => made.get(path))
        .filter((node): node is FolderNode => node !== undefined)
        .toSorted(byNameThenPath);
}

function byNameThenPath(a: FolderNode, b: FolderNode): number {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function nearestAncestor(path: string, known: ReadonlyMap<string, FolderStat>): string | undefined {
    if (path === '.') {
        return undefined;
    }
    for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) {
        const candidate = path.slice(0, at);
        if (known.has(candidate)) {
            return candidate;
        }
    }
    return known.has('.') ? '.' : undefined;
}

/** Every folder of the trees, parents first. */
export function flatten(roots: readonly FolderNode[]): FolderNode[] {
    const out: FolderNode[] = [];
    const pending = roots.toReversed();
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        out.push(next);
        pending.push(...next.children.toReversed());
    }
    return out;
}

/** How many folders are within their limit, of those that have one. */
export interface Health {
    readonly within: number;
    readonly total: number;
    /** Whole percent; 100 only when every folder is within (a rounded 100 would hide the one that is not). */
    readonly percent: number;
}

/** `undefined` when no folder has a limit: there is nothing to be within. */
export function healthOf(stats: readonly Pick<FolderStat, 'limit' | 'used'>[]): Health | undefined {
    let total = 0;
    let within = 0;
    for (const stat of stats) {
        if (stat.limit === null) continue;
        total++;
        if (stat.used <= stat.limit) within++;
    }
    if (total === 0) {
        return undefined;
    }
    const rounded = Math.round((within / total) * 100);
    return { within, total, percent: within < total ? Math.min(rounded, 99) : 100 };
}

/**
 * "95 % of folders within the max-files limit (113/119)": the figure of the summary line. It names the
 * rule because it measures only max-files: a run that fails on prefix-groups can still be at 100 %.
 */
export function describeHealth(health: Health): string {
    return `${health.percent} % of folders within the max-files limit (${health.within}/${health.total})`;
}

/** What `tree` keeps of the folders. */
export interface TreeFilter {
    /** Levels below the root that are shown; the rest is folded into its parent's line. */
    readonly depth: number;
    /** Keep only the folders at or above this level, and the folders above them. */
    readonly only?: 'near' | 'over' | undefined;
}

/** A line of the tree: a folder, how deep it is drawn, and what is folded under it. */
export interface TreeRow {
    readonly node: FolderNode;
    readonly depth: number;
    /** Whether it is the last of its parent's lines, for the branch it hangs from. */
    readonly last: boolean;
    /** The branch glyph prefix of its ancestors: true where an ancestor has more lines below. */
    readonly trail: readonly boolean[];
    /** The folders below it that the depth hides, and how many of those are over their limit or near it. */
    readonly hidden: { readonly folders: number; readonly over: number; readonly near: number };
}

const matches = (node: FolderNode, only: TreeFilter['only']): boolean =>
    only === undefined || node.level === 'over' || (only === 'near' && node.level === 'near');

/** The rows `tree` prints: the filter applied, then the depth, with what the depth hides counted. */
export function treeRows(roots: readonly FolderNode[], filter: TreeFilter): TreeRow[] {
    // A folder is kept when it matches, or something below it does: the path to a problem stays.
    const keeps = new Map<string, boolean>();
    for (const node of flatten(roots).toReversed()) {
        keeps.set(node.path, matches(node, filter.only) || node.children.some(child => keeps.get(child.path) === true));
    }
    const rows: TreeRow[] = [];
    const walk = (nodes: readonly FolderNode[], depth: number, trail: readonly boolean[]): void => {
        const shown = nodes.filter(node => keeps.get(node.path) === true);
        for (const [index, node] of shown.entries()) {
            const last = index === shown.length - 1;
            const collapsed = depth >= filter.depth;
            rows.push({
                node,
                depth,
                last,
                trail,
                hidden: collapsed ? hiddenBelow(node, filter.only, keeps) : NO_HIDDEN,
            });
            if (!collapsed) {
                walk(node.children, depth + 1, [...trail, !last]);
            }
        }
    };
    walk(roots, 0, []);
    return rows;
}

const NO_HIDDEN = { folders: 0, over: 0, near: 0 } as const;

function hiddenBelow(
    node: FolderNode,
    only: TreeFilter['only'],
    keeps: ReadonlyMap<string, boolean>,
): TreeRow['hidden'] {
    let folders = 0;
    let over = 0;
    let near = 0;
    for (const below of flatten(node.children)) {
        if (keeps.get(below.path) !== true) continue;
        if (matches(below, only)) {
            folders++;
        }
        if (below.level === 'over') over++;
        else if (below.level === 'near') near++;
    }
    return { folders, over, near };
}

/** "3 folders below, 1 over": what a folded line says about what it hides. */
export function describeHidden(hidden: TreeRow['hidden']): string {
    if (hidden.folders === 0) {
        return '';
    }
    const problems = [hidden.over > 0 ? `${hidden.over} over` : '', hidden.near > 0 ? `${hidden.near} near` : '']
        .filter(part => part !== '')
        .join(', ');
    return `${plural(hidden.folders, 'folder')} below${problems === '' ? '' : `: ${problems}`}`;
}
