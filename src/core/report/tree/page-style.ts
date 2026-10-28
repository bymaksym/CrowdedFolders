/**
 * The stylesheet of the HTML report, as text: the page is one file with nothing to fetch, and the core cannot
 * read files. It has no backtick, so it is a plain `String.raw`. Light and dark follow the reader's system.
 */

export const PAGE_CSS = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --surface: #ffffff; --ink: #1b1f24; --muted: #5b6570; --line: #dde1e6; --accent: #2457c5;
  --cell-ink: #1b1f24; --cell-edge: #f6f7f9; --focus: #2457c5; --shadow: 0 1px 2px rgb(16 24 40 / .06), 0 4px 16px rgb(16 24 40 / .06);
  --c-ok: #4fb39f; --c-near: #e8b04a; --c-over: #d9534f;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216; --surface: #171b21; --ink: #e8ebef; --muted: #98a2ad; --line: #2a3038; --accent: #7aa2ff;
    --cell-ink: #f1f3f5; --cell-edge: #0f1216; --focus: #9db9ff; --shadow: 0 1px 2px rgb(0 0 0 / .4), 0 4px 16px rgb(0 0 0 / .35);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--sans); }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.wrap { max-width: 1320px; margin: 0 auto; padding: 24px 16px 40px; }
header.top { display: flex; flex-wrap: wrap; gap: 16px 32px; align-items: flex-end; justify-content: space-between; margin-bottom: 20px; }
h1 { margin: 0; font-size: 1.5rem; line-height: 1.2; letter-spacing: -.01em; }
.sub { margin: 4px 0 0; color: var(--muted); font-size: .9rem; }
.sub code, .path, code { font-family: var(--mono); font-size: .92em; }
.health { display: flex; align-items: center; gap: 16px; min-width: 0; }
.health .big { font-size: 2.6rem; font-weight: 700; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.health .big small { font-size: 1.2rem; font-weight: 600; margin-left: 2px; color: var(--muted); }
.health .what { color: var(--muted); font-size: .9rem; line-height: 1.35; }
.health .what b { color: var(--ink); font-weight: 600; }
.split { display: flex; height: 8px; width: 220px; max-width: 100%; border-radius: 4px; overflow: hidden; margin-top: 6px; background: var(--line); }
.split span { display: block; height: 100%; }
.split .ok { background: var(--c-ok); } .split .near { background: var(--c-near); } .split .over { background: var(--c-over); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 2px 11px; font-size: .84rem; display: inline-flex; gap: 6px; align-items: center; }
.chip:hover { border-color: var(--accent); }
.chip i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.tabs button { border: 0; background: transparent; padding: 6px 14px; }
.tabs button[aria-pressed="true"] { background: var(--accent); color: #fff; }
@media (prefers-color-scheme: dark) { .tabs button[aria-pressed="true"] { color: #0b1020; } }
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; min-width: 0; font-family: var(--mono); font-size: .88rem; }
.crumbs button { border: 0; background: transparent; padding: 3px 6px; border-radius: 6px; color: var(--accent); max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumbs button:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.crumbs button[aria-current="location"] { color: var(--ink); font-weight: 600; cursor: default; }
.crumbs .sep { color: var(--muted); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .82rem; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 14px; height: 14px; border-radius: 4px; display: inline-block; border: 1px solid rgb(0 0 0 / .12); }
.stage { display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
#map { position: relative; height: clamp(380px, 68vh, 760px); margin: 12px; overflow: hidden; border-radius: 8px; background: var(--bg); }
.cell { position: absolute; margin: 0; padding: 0; text-align: left; overflow: hidden; border: 2px solid var(--cell-edge); border-radius: 6px; color: var(--cell-ink); animation: pop .18s ease-out both; }
.cell.rest { opacity: .85; cursor: pointer; }
.cell:hover { filter: brightness(1.06) saturate(1.08); z-index: 3; }
.cell:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; z-index: 4; }
.cell.lv3::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgb(0 0 0 / .10) 0 2px, transparent 2px 9px); }
.cell .t { position: absolute; left: 7px; right: 6px; top: 4px; font-size: .8rem; font-weight: 600; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 1; }
.cell .n { position: absolute; left: 7px; right: 6px; top: 22px; font-size: .74rem; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; z-index: 1; }
.cell.open { box-shadow: inset 0 0 0 1px rgb(0 0 0 / .16); }
.cell.open > .t { top: 3px; right: auto; max-width: 58%; }
.cell.open > .n { top: 3px; left: auto; right: 7px; text-align: right; max-width: 40%; }
.cell.self { border-style: dashed; border-color: rgb(127 127 127 / .5); }
@keyframes pop { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cell { animation: none; } }
#detail { padding: 16px 16px 18px; border-left: 1px solid var(--line); min-width: 0; }
#detail h2 { margin: 0 0 2px; font-size: 1rem; font-family: var(--mono); word-break: break-all; }
#detail .lead { margin: 0 0 12px; color: var(--muted); font-size: .86rem; }
#detail dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 12px; font-size: .9rem; }
#detail dt { color: var(--muted); }
#detail dd { margin: 0; font-variant-numeric: tabular-nums; }
#detail h3 { margin: 14px 0 4px; font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
#detail p { margin: 6px 0; font-size: .88rem; }
#detail ul { margin: 4px 0; padding-left: 1.1em; font-size: .86rem; }
#detail li { margin: 4px 0; }
#detail pre { margin: 4px 0; padding: 8px 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; font: .78rem/1.45 var(--mono); overflow-x: auto; white-space: pre; }
.meter { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; margin: 2px 0 10px; }
.meter b { display: block; height: 100%; border-radius: 4px; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px 1px 7px; border-radius: 999px; font-size: .8rem; font-weight: 600; border: 1px solid var(--line); background: var(--bg); white-space: nowrap; }
.pill i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.btn { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 5px 12px; }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .45; cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (prefers-color-scheme: dark) { .btn.primary { color: #0b1020; } }
.hint { color: var(--muted); font-size: .8rem; padding: 0 14px 12px; margin: 0; }
.tablebar { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 12px; align-items: center; }
.tablebar input[type="search"], .tablebar select { border: 1px solid var(--line); background: var(--bg); border-radius: 8px; padding: 6px 10px; min-width: 0; }
.tablebar input[type="search"] { flex: 1 1 200px; }
.tablewrap { overflow-x: auto; padding: 0 12px 12px; }
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
caption { text-align: left; color: var(--muted); padding: 0 0 8px; font-size: .82rem; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { white-space: nowrap; font-weight: 600; position: sticky; top: 0; background: var(--surface); }
th button { border: 0; background: transparent; padding: 0; font-weight: 600; display: inline-flex; gap: 4px; align-items: center; }
th[aria-sort="ascending"] button::after { content: "\2191"; }
th[aria-sort="descending"] button::after { content: "\2193"; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td .link { border: 0; background: transparent; padding: 0; color: var(--accent); font-family: var(--mono); text-align: left; word-break: break-all; }
td .link:hover { text-decoration: underline; }
.cellbar { display: inline-block; width: 70px; height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; vertical-align: middle; margin-right: 8px; }
.cellbar b { display: block; height: 100%; }
.empty { padding: 28px 16px; color: var(--muted); text-align: center; }
footer.foot { margin-top: 18px; color: var(--muted); font-size: .8rem; display: flex; flex-wrap: wrap; gap: 4px 18px; }
noscript table { margin-top: 12px; }
@media (max-width: 900px) {
  .stage { grid-template-columns: minmax(0, 1fr); }
  #detail { border-left: 0; border-top: 1px solid var(--line); }
  #map { height: clamp(340px, 62vh, 560px); margin: 8px; }
}
@media (max-width: 520px) {
  .wrap { padding: 16px 16px 32px; }
  h1 { font-size: 1.25rem; }
  .health .big { font-size: 2.2rem; }
  .toolbar { padding: 8px; }
  .hint { padding: 0 10px 10px; }
}
`;
