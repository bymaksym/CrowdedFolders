import { plainMessage } from '../describe.ts';
import type { Report } from '../report.ts';
import {
    buildFolderTree,
    describeHealth,
    flatten,
    type FolderNode,
    healthOf,
    type Level,
} from '../tree/folder-tree.ts';
import { PAGE_SCRIPT } from '../tree/page-script.ts';
import { PAGE_CSS } from '../tree/page-style.ts';
import { describeTiny } from '../tree/tiny.ts';
import { layoutTreemap, squarify } from '../tree/treemap.ts';
import { compareWithTrial, describeComparison } from '../tree/trial.ts';
import { FIELD_TRIAL } from '../tree/trial-data.ts';

/** A folder as the page's script reads it: short keys, because a large repository has thousands. */
export interface PageNode {
    /** Path from the root (`.` is the root; the empty string is the made-up root over several). */
    readonly p: string;
    /** Name. */
    readonly n: string;
    /** What `max-files` counts, and its unit (`m` modules, `f` files). */
    readonly u: number;
    readonly k: 'f' | 'm';
    readonly m: number;
    readonly f: number;
    /** The limit; `null` when no rule sets one. */
    readonly l: number | null;
    /** 0 no limit, 1 within, 2 near, 3 over. */
    readonly v: 0 | 1 | 2 | 3;
    /** The layout weights: the folder with everything below it, and its own modules. */
    readonly w: number;
    readonly s: number;
    /** Bigger than this percent of the folders of the field trial. */
    readonly q?: number;
    /** A note: most files are tiny. */
    readonly t?: string;
    /** Findings: rule, `e` or `w`, message, moves as `[from, to]`. */
    readonly r?: readonly (readonly [string, 'e' | 'w', string, readonly (readonly [string, string])[]])[];
    readonly c?: readonly PageNode[];
}

type PageSource = Pick<Report, 'fileCount' | 'findings' | 'folderStats' | 'hide' | 'run' | 'tinyFiles' | 'tool'>;

const CODES: Readonly<Record<Level, 0 | 1 | 2 | 3>> = { none: 0, ok: 1, near: 2, over: 3 };

const FLAVOUR: Readonly<Record<Level, string>> = {
    ok: 'within the limit',
    near: 'near the limit',
    over: 'over the limit',
    none: 'no limit',
};

/** The most moves and the longest message kept per finding: the page is for looking, `--moves` is for doing. */
const MOVES_KEPT = 8;
const MESSAGE_KEPT = 400;

function pageNode(node: FolderNode, report: PageSource): PageNode {
    const { stat } = node;
    const findings = report.findings.filter(
        finding => finding.folder === node.path && !finding.rule.startsWith('config/'),
    );
    const comparison = compareWithTrial(stat.modules);
    const tiny = report.tinyFiles?.[node.path];
    return {
        p: node.path,
        n: node.name,
        u: stat.used,
        k: stat.unit === 'files' ? 'f' : 'm',
        m: stat.modules,
        f: stat.files,
        l: stat.limit,
        v: CODES[node.level],
        w: node.weight,
        s: stat.modules,
        ...(comparison && { q: comparison.biggerThan }),
        ...(tiny && { t: describeTiny(tiny) }),
        ...(findings.length > 0 && {
            r: findings.map(finding => [
                finding.rule,
                finding.severity === 'error' ? ('e' as const) : ('w' as const),
                plainMessage(report, finding).slice(0, MESSAGE_KEPT),
                finding.moves.slice(0, MOVES_KEPT).map(move => [move.from, move.to] as const),
            ]),
        }),
        ...(node.children.length > 0 && { c: node.children.map(child => pageNode(child, report)) }),
    };
}

/** Text for an HTML attribute or element: the five characters that mean something there. */
export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const LINE_SEPARATOR = String.fromCodePoint(0x20_28);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x20_29);
const BACKSLASH = String.fromCodePoint(0x5c);

/** JSON that can sit inside a `<script>`: `<` cannot start `</script>` or `<!--`, and the line separators are plain. */
function jsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replaceAll('<', () => `${BACKSLASH}u003c`)
        .replaceAll(LINE_SEPARATOR, () => `${BACKSLASH}u2028`)
        .replaceAll(PARAGRAPH_SEPARATOR, () => `${BACKSLASH}u2029`);
}

/**
 * The folders as one HTML file: a zoomable treemap coloured by how near each folder is to its limit, and
 * the same folders as a sortable table. Everything is in the file (style, script, data), so it can be
 * attached to a pull request, kept as a CI artifact or mailed: nothing is fetched, and nothing runs but
 * the page's own script. Without script, the folders over or near their limit are still listed.
 */
export function formatHtml(report: PageSource): string {
    const stats = report.folderStats ?? [];
    const roots = buildFolderTree(stats);
    const all = flatten(roots);
    const health = healthOf(stats);
    const over = all.filter(node => node.level === 'over');
    const near = all.filter(node => node.level === 'near');
    // A root written from where the command ran (`../../x`) says nothing to whoever opens the file later.
    const ran = report.run?.root;
    const rootName = ran === undefined || ran === '.' || ran.startsWith('..') ? 'the repository' : ran;

    const kids = roots.map(root => pageNode(root, report));
    const only = kids.length === 1 ? kids[0] : undefined;
    const root: PageNode = only ?? {
        p: '',
        n: '',
        u: 0,
        k: 'm',
        m: 0,
        f: 0,
        l: null,
        v: 0,
        w: kids.reduce((sum, kid) => sum + kid.w, 0),
        s: 0,
        c: kids,
    };
    const data = {
        meta: { root: rootName, trial: { repos: FIELD_TRIAL.repos, folders: FIELD_TRIAL.folders } },
        root,
    };

    const biggest = over.toSorted((a, b) => b.stat.modules - a.stat.modules || (a.path < b.path ? -1 : 1))[0];
    const comparison = biggest === undefined ? undefined : describeComparison(biggest.stat.modules);
    const withLimit = health?.total ?? 0;
    const share = (count: number): string => (withLimit === 0 ? '0' : ((count / withLimit) * 100).toFixed(2));
    const within = withLimit - over.length - near.length;
    const fallback = [...over, ...near.toSorted((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))].slice(0, 200);
    const count = (n: number): string => n.toLocaleString('en-US');

    const sub = [
        `<p class="sub">${escapeHtml(rootName)} &middot; ${count(all.length)} folders &middot; ${count(report.fileCount)} files checked</p>`,
        ...(biggest === undefined || comparison === undefined
            ? []
            : [`<p class="sub">The biggest, <code>${escapeHtml(biggest.path)}</code>: ${escapeHtml(comparison)}</p>`]),
    ];
    const healthBlock =
        health === undefined
            ? ''
            : `<div class="health">
    <div class="big">${health.percent}<small>%</small></div>
    <div class="what"><b>of folders within the max-files limit</b><br>${count(health.within)} of ${count(health.total)}
      <div class="split" role="img" aria-label="${escapeHtml(describeHealth(health))}; ${over.length} over, ${near.length} near"><span class="ok" style="width:${share(within)}%"></span><span class="near" style="width:${share(near.length)}%"></span><span class="over" style="width:${share(over.length)}%"></span></div>
      <div class="chips">
        <button type="button" class="chip" data-show="3"><i style="background:var(--c-over)"></i>${over.length} over the limit</button>
        <button type="button" class="chip" data-show="2"><i style="background:var(--c-near)"></i>${near.length} near it</button>
      </div>
    </div>
  </div>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)}">
<title>${escapeHtml(`Crowded folders - ${rootName}`)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <div>
    <h1>Crowded folders</h1>
    ${sub.join('\n    ')}
  </div>
  ${healthBlock}
</header>
<main class="card">
  <div class="toolbar">
    <div class="tabs" role="group" aria-label="View"><button type="button" id="tab-map" aria-pressed="true">Map</button><button type="button" id="tab-table" aria-pressed="false">Table</button></div>
    <div class="legend" id="legend" aria-label="Colours"></div>
  </div>
  <section id="mapview" aria-label="Treemap of the folders">
    <div class="toolbar" style="border-bottom:0;padding-bottom:0">
      <button type="button" class="btn" id="up" title="Zoom out (Esc)">&larr; Up</button>
      <nav class="crumbs" id="crumbs" aria-label="Folder shown"></nav>
    </div>
    <div class="stage">
      <div id="map" role="group" aria-label="Folders, sized by the modules in them and coloured by how near each is to its limit. Enter zooms in, Esc zooms out."></div>
      <aside id="detail" role="status" aria-label="Details of the folder"></aside>
    </div>
    <p class="hint">Size is the number of modules in a folder and everything below it. Colour is the share of its own limit, and the hatched cells are over it. Enter zooms in, Esc zooms out; the Table view lists every folder.</p>
  </section>
  <section id="tableview" aria-label="Table of the folders" hidden>
    <div class="tablebar">
      <input type="search" id="filter-text" placeholder="Filter by path" aria-label="Filter by path">
      <select id="filter-level" aria-label="Show"><option value="0">All folders</option><option value="2">Near the limit or over</option><option value="3">Over the limit</option></select>
    </div>
    <div class="tablewrap"><table id="table"></table><div id="more"></div></div>
  </section>
</main>
<noscript>
  <h2>Folders over or near their limit</h2>
${staticTable(fallback)}
</noscript>
<footer class="foot">
  <span>${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)}</span>
  <span>File sizes, where noted, come from git's records: no file was read.</span>
</footer>
</div>
<script type="application/json" id="data">${jsonForScript(data)}</script>
<script>
${squarify.toString()}
${layoutTreemap.toString()}
${PAGE_SCRIPT}</script>
</body>
</html>
`;
}

/** The folders as a plain table, for a browser that does not run the page's script. */
function staticTable(nodes: readonly FolderNode[]): string {
    if (nodes.length === 0) {
        return '  <p>No folder is over or near its limit.</p>';
    }
    const rows = nodes.map(
        node =>
            `    <tr><td>${escapeHtml(node.path)}</td><td>${node.stat.used}${node.stat.limit === null ? '' : `/${node.stat.limit}`}</td><td>${FLAVOUR[node.level]}</td></tr>`,
    );
    return `  <table>\n    <thead><tr><th>Folder</th><th>Used/limit</th><th>Status</th></tr></thead>\n${rows.join('\n')}\n  </table>`;
}
