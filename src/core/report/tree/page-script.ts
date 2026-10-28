/**
 * The behaviour of the HTML report, as text. It is plain browser JavaScript with no library. It draws the
 * treemap with `layoutTreemap`, whose text `html.ts` puts in front of it (see treemap.ts). Everything it shows
 * from the data it shows with `textContent`, never `innerHTML`, so a folder called `<img onerror=...>` is only a
 * name. It has no backtick and no `${`, so it is a plain `String.raw`.
 */

export const PAGE_SCRIPT = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  var meta = data.meta;
  var root = data.root;
  var nodes = [];
  var byPath = Object.create(null);
  var parentOf = Object.create(null);
  (function walk(n, up) {
    nodes.push(n);
    byPath[n.p] = n;
    parentOf[n.p] = up;
    (n.c || []).forEach(function (c) { walk(c, n); });
  })(root, null);

  var WORD = ['no limit', 'within the limit', 'near the limit', 'over the limit'];
  var PALETTE = {
    light: { none: [226, 229, 234], stops: [[0, [208, 233, 222]], [0.5, [220, 236, 208]], [0.6, [244, 230, 160]], [1, [243, 186, 126]], [1.5, [236, 140, 122]], [2, [218, 98, 90]]] },
    dark: { none: [46, 51, 58], stops: [[0, [26, 66, 61]], [0.5, [40, 70, 50]], [0.6, [92, 79, 26]], [1, [128, 78, 26]], [1.5, [152, 60, 50]], [2, [180, 50, 44]]] }
  };
  var scheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function isDark() { return !!(scheme && scheme.matches); }
  function rgb(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function tint(ratio) {
    var p = isDark() ? PALETTE.dark : PALETTE.light;
    if (ratio === null) return rgb(p.none);
    var s = p.stops;
    if (ratio <= s[0][0]) return rgb(s[0][1]);
    for (var i = 1; i < s.length; i++) {
      if (ratio <= s[i][0]) {
        var t = (ratio - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        var a = s[i - 1][1], b = s[i][1];
        return rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return rgb(s[s.length - 1][1]);
  }
  function ratioOf(n) { return n.l ? n.u / n.l : null; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function name(n) { return n.p === '.' || n.p === '' ? meta.root : n.p; }
  function countText(n) { return n.l === null ? String(n.u) : n.u + '/' + n.l; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  var cur = root;
  var pinned = null;
  var view = 'map';
  var tableFilter = { level: 0, text: '' };
  var sort = { key: 'ratio', dir: -1 };
  var rowLimit = 250;
  var keyboardZoom = false;

  /* ---------- the details of a folder ---------- */
  function describeNode(n, own) {
    var t = (own ? 'Files directly in ' : '') + name(n) + ': ' + countText(n) + ' ' + (n.k === 'f' ? 'files' : 'modules');
    t += ', ' + WORD[n.v];
    if (n.c && n.c.length && !own) t += ', ' + plural(n.c.length, 'folder') + ' below. Enter zooms in';
    return t;
  }
  function showDetail(n) {
    var box = $('detail');
    box.textContent = '';
    var node = n || pinned || cur;
    box.appendChild(el('h2', null, name(node)));
    var lead = node === cur ? 'The folder shown on the map' : (n ? 'Under the pointer' : 'Selected');
    box.appendChild(el('p', 'lead', lead));
    var pill = el('span', 'pill');
    var dot = el('i');
    dot.style.background = tint(ratioOf(node));
    dot.style.border = '1px solid rgba(127,127,127,.5)';
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(WORD[node.v]));
    var p0 = el('p');
    p0.appendChild(pill);
    box.appendChild(p0);
    if (node.l !== null) {
      var meter = el('div', 'meter');
      var fill = el('b');
      fill.style.width = Math.min(100, Math.round((node.u / node.l) * 100)) + '%';
      fill.style.background = tint(ratioOf(node));
      meter.appendChild(fill);
      box.appendChild(meter);
    }
    var dl = el('dl');
    function row(k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    row(node.k === 'f' ? 'Files' : 'Modules', node.l === null ? String(node.u) : node.u + ' of ' + node.l + ' allowed');
    row(node.k === 'f' ? 'Modules' : 'Files', String(node.k === 'f' ? node.m : node.f));
    row('Folders below', String(node.c ? node.c.length : 0));
    row('Limit', node.l === null ? 'none (max-files is off here)' : String(node.l));
    box.appendChild(dl);
    if (node.q !== undefined && node.m > 0) {
      box.appendChild(el('h3', null, 'Against open source'));
      box.appendChild(el('p', null, node.m + ' ' + (node.m === 1 ? 'module' : 'modules') + ': bigger than ' + node.q + ' % of the folders of ' + meta.trial.repos + ' open-source repositories (n=' + meta.trial.folders.toLocaleString('en-US') + ').'));
    }
    if (node.t) {
      box.appendChild(el('h3', null, 'Note'));
      box.appendChild(el('p', null, node.t));
    }
    if (node.r && node.r.length) {
      box.appendChild(el('h3', null, plural(node.r.length, 'finding')));
      var ul = el('ul');
      node.r.forEach(function (f) {
        var li = el('li');
        li.appendChild(el('code', null, f[0]));
        li.appendChild(document.createTextNode(' ' + f[2]));
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var moves = [];
      node.r.forEach(function (f) { f[3].forEach(function (m) { moves.push(m); }); });
      if (moves.length) {
        box.appendChild(el('h3', null, 'Suggested moves'));
        var shown = moves.slice(0, 6).map(function (m) { return 'git mv ' + m[0] + ' ' + m[1]; });
        if (moves.length > 6) shown.push('... and ' + (moves.length - 6) + ' more (run with --moves)');
        box.appendChild(el('pre', null, shown.join('\n')));
        box.appendChild(el('p', 'lead', 'Nothing is moved for you: moving breaks imports, and that is your call.'));
      }
    }
    if (node.c && node.c.length && node !== cur) {
      var go = el('button', 'btn primary', 'Zoom into this folder');
      go.type = 'button';
      go.addEventListener('click', function () { zoom(node); });
      var wrap = el('p');
      wrap.appendChild(go);
      box.appendChild(wrap);
    }
  }

  /* ---------- the map ---------- */
  function cellElement(cell) {
    var n = cell.node;
    var rest = cell.rest;
    var e = el(rest ? 'div' : 'button', 'cell');
    if (!rest) e.type = 'button';
    var level = rest ? 0 : n.v;
    var own = cell.self;
    var ratio = rest ? null : ratioOf(n);
    e.className += ' d' + cell.depth + (cell.open ? ' open' : '') + (own ? ' self' : '') + (rest ? ' rest' : '') + ' lv' + level;
    e.style.left = cell.x + 'px';
    e.style.top = cell.y + 'px';
    e.style.width = cell.w + 'px';
    e.style.height = cell.h + 'px';
    e.style.background = tint(ratio);
    var title = rest ? '+' + rest.length + ' smaller' : own ? 'files in ' + (n.p === '.' ? 'the root' : n.n) : n.n;
    if (cell.w >= 48 && cell.h >= 20) e.appendChild(el('span', 't', title));
    if (!rest && cell.w >= 84 && (cell.open || cell.h >= 40)) {
      e.appendChild(el('span', 'n', cell.open || cell.w < 150 ? countText(n) : countText(n) + '  ' + WORD[level]));
    }
    if (rest) {
      e.title = rest.length + ' smaller folders: open the table to see them';
      e.addEventListener('click', function () { tableFilter.text = cell.parent && cell.parent.p !== '' && cell.parent.p !== '.' ? cell.parent.p + '/' : ''; tableFilter.level = 0; setView('table'); });
    } else {
      e.setAttribute('aria-label', describeNode(n, own));
      e.addEventListener('mouseenter', function () { showDetail(n); });
      e.addEventListener('mouseleave', function () { showDetail(null); });
      e.addEventListener('focus', function () { showDetail(n); });
      e.addEventListener('blur', function () { showDetail(null); });
      e.addEventListener('click', function (ev) {
        keyboardZoom = ev.detail === 0;
        if (n.c && n.c.length && n !== cur) zoom(n);
        else { pinned = n; showDetail(n); }
      });
    }
    return e;
  }
  function renderMap() {
    var box = $('map');
    var w = box.clientWidth, h = box.clientHeight;
    box.textContent = '';
    if (!w || !h) return;
    var cells;
    if (cur.c && cur.c.length) {
      cells = layoutTreemap(cur, { x: 0, y: 0, w: w, h: h }, { depth: 3, header: 24, gap: 4, openWidth: 120, openHeight: 86, most: 30 });
    } else {
      cells = [{ x: 0, y: 0, w: w, h: h, node: cur, parent: null, depth: 1, open: false, self: false }];
    }
    var frag = document.createDocumentFragment();
    cells.forEach(function (c) { frag.appendChild(cellElement(c)); });
    box.appendChild(frag);
    if (keyboardZoom) {
      keyboardZoom = false;
      var first = box.querySelector('button.cell');
      if (first) first.focus();
    }
  }
  function renderCrumbs() {
    var box = $('crumbs');
    box.textContent = '';
    var chain = [];
    for (var n = cur; n; n = parentOf[n.p]) chain.unshift(n);
    chain.forEach(function (n, i) {
      if (i > 0) box.appendChild(el('span', 'sep', '/'));
      var b = el('button', null, i === 0 ? name(n) : n.n);
      b.type = 'button';
      if (n === cur) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', function () { zoom(n); });
      box.appendChild(b);
    });
  }
  function renderLegend() {
    var box = $('legend');
    box.textContent = '';
    [[0.25, 'within the limit'], [0.8, 'near it (60 % or more)'], [1.4, 'over the limit'], [null, 'no limit']].forEach(function (item) {
      var s = el('span');
      var sw = el('i');
      sw.style.background = tint(item[0]);
      s.appendChild(sw);
      s.appendChild(document.createTextNode(item[1]));
      box.appendChild(s);
    });
  }
  function zoom(n) {
    cur = n;
    pinned = null;
    try { if (history.replaceState) history.replaceState(null, '', n === root ? location.pathname + location.search : '#' + encodeURIComponent(n.p)); } catch (e) { /* a page opened from a strict sandbox */ }
    if (view !== 'map') setView('map');
    render();
  }
  function up() { var p = parentOf[cur.p]; if (p) zoom(p); }

  /* ---------- the table ---------- */
  var COLUMNS = [
    { key: 'p', label: 'Folder', get: function (n) { return n.p; } },
    { key: 'u', label: 'Used', num: true, get: function (n) { return n.u; } },
    { key: 'l', label: 'Limit', num: true, get: function (n) { return n.l === null ? -1 : n.l; } },
    { key: 'ratio', label: 'Of the limit', get: function (n) { var r = ratioOf(n); return r === null ? -1 : r; } },
    { key: 'v', label: 'Status', get: function (n) { return n.v; } },
    { key: 'r', label: 'Findings', num: true, get: function (n) { return n.r ? n.r.length : 0; } },
    { key: 'f', label: 'Files', num: true, get: function (n) { return n.f; } }
  ];
  function tableRows() {
    var text = tableFilter.text.toLowerCase();
    var list = nodes.filter(function (n) {
      if (n.p === '') return false;
      if (tableFilter.level === 3 && n.v !== 3) return false;
      if (tableFilter.level === 2 && n.v < 2) return false;
      return text === '' || n.p.toLowerCase().indexOf(text) !== -1;
    });
    var col = COLUMNS.filter(function (c) { return c.key === sort.key; })[0] || COLUMNS[0];
    list.sort(function (a, b) {
      var x = col.get(a), y = col.get(b);
      if (x < y) return -sort.dir;
      if (x > y) return sort.dir;
      return a.p < b.p ? -1 : 1;
    });
    return list;
  }
  function renderTable() {
    var rows = tableRows();
    var table = $('table');
    table.textContent = '';
    var cap = el('caption', null, rows.length === nodes.length - (byPath[''] ? 1 : 0) ? plural(rows.length, 'folder') : plural(rows.length, 'folder') + ' match');
    table.appendChild(cap);
    var head = el('thead');
    var hr = el('tr');
    COLUMNS.forEach(function (c) {
      var th = el('th', c.num ? 'num' : null);
      th.scope = 'col';
      th.setAttribute('aria-sort', sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      var b = el('button', null, c.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (sort.key === c.key) sort.dir = -sort.dir; else { sort.key = c.key; sort.dir = c.key === 'p' ? 1 : -1; }
        renderTable();
      });
      th.appendChild(b);
      hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    rows.slice(0, rowLimit).forEach(function (n) {
      var tr = el('tr');
      var td = el('td');
      if (n.c && n.c.length) {
        var link = el('button', 'link', n.p);
        link.type = 'button';
        link.title = 'Show on the map';
        link.addEventListener('click', function () { zoom(n); });
        td.appendChild(link);
      } else td.appendChild(el('span', 'path', n.p));
      tr.appendChild(td);
      tr.appendChild(el('td', 'num', String(n.u) + (n.k === 'f' ? ' files' : '')));
      tr.appendChild(el('td', 'num', n.l === null ? '-' : String(n.l)));
      var share = el('td');
      var r = ratioOf(n);
      if (r !== null) {
        var bar = el('span', 'cellbar');
        var f = el('b');
        f.style.width = Math.min(100, Math.round(r * 100)) + '%';
        f.style.background = tint(Math.max(r, 0.05));
        bar.appendChild(f);
        share.appendChild(bar);
        share.appendChild(document.createTextNode(Math.round(r * 100) + ' %'));
      } else share.appendChild(document.createTextNode('-'));
      tr.appendChild(share);
      var st = el('td');
      var pill = el('span', 'pill');
      var dot = el('i');
      dot.style.background = tint(r);
      dot.style.border = '1px solid rgba(127,127,127,.5)';
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode(WORD[n.v]));
      st.appendChild(pill);
      tr.appendChild(st);
      tr.appendChild(el('td', 'num', n.r ? String(n.r.length) : '0'));
      tr.appendChild(el('td', 'num', String(n.f)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    var more = $('more');
    more.textContent = '';
    if (rows.length === 0) more.appendChild(el('p', 'empty', 'No folder matches.'));
    else if (rows.length > rowLimit) {
      var b = el('button', 'btn', 'Show all ' + rows.length + ' (' + (rows.length - rowLimit) + ' more)');
      b.type = 'button';
      b.addEventListener('click', function () { rowLimit = Infinity; renderTable(); });
      var p = el('p', 'empty');
      p.appendChild(b);
      more.appendChild(p);
    }
  }

  /* ---------- the page ---------- */
  function setView(v) {
    view = v;
    $('mapview').hidden = v !== 'map';
    $('tableview').hidden = v !== 'table';
    $('tab-map').setAttribute('aria-pressed', String(v === 'map'));
    $('tab-table').setAttribute('aria-pressed', String(v === 'table'));
    if (v === 'map') render(); else { $('filter-text').value = tableFilter.text; $('filter-level').value = String(tableFilter.level); renderTable(); }
  }
  function render() {
    $('up').disabled = !parentOf[cur.p];
    renderCrumbs();
    renderMap();
    showDetail(null);
  }
  $('tab-map').addEventListener('click', function () { setView('map'); });
  $('tab-table').addEventListener('click', function () { setView('table'); });
  $('up').addEventListener('click', up);
  $('filter-text').addEventListener('input', function (e) { tableFilter.text = e.target.value; rowLimit = 250; renderTable(); });
  $('filter-level').addEventListener('change', function (e) { tableFilter.level = Number(e.target.value); rowLimit = 250; renderTable(); });
  [].forEach.call(document.querySelectorAll('[data-show]'), function (b) {
    b.addEventListener('click', function () { tableFilter.level = Number(b.getAttribute('data-show')); tableFilter.text = ''; rowLimit = 250; setView('table'); });
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (typing || e.ctrlKey || e.metaKey) return;
    if (view === 'map' && (e.key === 'Escape' || e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft'))) { e.preventDefault(); keyboardZoom = true; up(); }
  });
  var timer = 0;
  function again() { if (timer) return; timer = window.requestAnimationFrame(function () { timer = 0; if (view === 'map') renderMap(); }); }
  if (window.ResizeObserver) new ResizeObserver(again).observe($('map')); else window.addEventListener('resize', again);
  if (scheme && scheme.addEventListener) scheme.addEventListener('change', function () { renderLegend(); render(); if (view === 'table') renderTable(); });
  window.addEventListener('hashchange', function () {
    var p = decodeURIComponent(location.hash.slice(1));
    var n = p === '' ? root : byPath[p];
    if (n && n !== cur) { cur = n; render(); }
  });
  var start = decodeURIComponent(location.hash.slice(1));
  if (start && byPath[start]) cur = byPath[start];
  renderLegend();
  setView('map');
})();
`;
