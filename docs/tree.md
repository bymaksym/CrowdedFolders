# The map of the folders: tree, HTML and badge

`crowded-folders` checks folders against a limit; these three outputs show how near each folder is to it.
All of them read the same numbers as `--stats`: the modules of every folder and the `max-files` limit in
effect there (an override can give one folder another limit).

## `crowded-folders tree [folder]`

The folders as a tree, in the terminal. Each line has the count over the limit, a bar and a word:

```text
.                 15/40  ####......   ok
   |- docs/       10/12  ########..   near the limit
   |- src/         5/12  ####......   ok
   |  |- cli/      9/12  ########..   near the limit  (4 folders below)
   |  `- node/    12/12  ##########   near the limit
   `- tooling/     4/12  ###.......   ok

30 folders; 100 % of folders within the limit (30/30); 0 over the limit; 10 near it.
```

- **Colour is never the only signal.** The word is always printed (`ok`, `near the limit`, `over the
limit`, `no limit`), and without a terminal (a pipe, `TERM=dumb`) the branches and the bar are ASCII.
  On a terminal, ok is green, near is yellow and over is red. A folder is _near_ at 60 % of its limit, the
  same share the "closest to the limit" line of a clean run uses.
- `--depth <n|all>` folds the folders under that depth (default 3). A folded line says what it hides:
  `(14 folders below: 6 near)`, so a problem is never out of sight.
- `--over` keeps only the folders over their limit, `--near` those and the ones near it; the folders
  above them stay, so the way to each one is shown.
- `crowded-folders tree src/core` starts at a folder. The command reports and does not judge: it exits
  0 (a wrong configuration is still 2).
- A folder over its limit whose files are mostly tiny gets a note (see below).
- The biggest folder over its limit is compared with the field trial: "The biggest, `src/x`: 29 modules:
  bigger than 97 % of the folders of 36 open-source repositories (n=17,938)." The same sentence is in
  `explain`.

`-f tree` gives the same from `check`, and `-f tree=folders.txt` writes it to a file.

## `--format html`

```sh
crowded-folders tree -f html=crowded-folders.html     # or: crowded-folders -f html=map.html
```

**One file**: style, script and data are inside it, nothing is fetched and no library is used, so it can
be attached to a pull request, kept as a CI artifact or mailed. It shows:

- a **treemap**: each folder is a rectangle whose area is the modules in it and below it, laid out by a
  squarified algorithm (`src/core/report/tree/treemap.ts`, tested without a browser; the page runs the
  same functions again when the window changes size). A folder with files of its own and folders below
  gets a dashed cell for its files, so a drawer with three small folders in it is still drawn as a drawer.
- **colour by closeness to the limit**: teal within, yellow near, orange at the limit, red over, grey
  with no limit; folders over the limit are also hatched, so the colour is not the only signal. Light and
  dark follow the system (`prefers-color-scheme`).
- **zoom**: click or press Enter on a folder to zoom in, Esc, Backspace or the Up button to zoom out, the
  breadcrumb to jump. The address keeps the folder (`#src/core`).
- **details** on hover, focus or tap: modules, files, limit, the findings with their messages, the
  suggested moves (as `git mv`; nothing is moved) and how big the folder is among the field trial.
- a **table** of every folder, sortable and filterable, as the alternative to the map. Without
  JavaScript, the page lists the folders over or near their limit.

Keyboard: Tab goes through the folders, Enter zooms, Esc zooms out; the table is a plain `<table>`.
Every name is put in the page as text, never as HTML.

On a very large repository the page holds every folder (about 400 kB for 4,000 folders) and draws the
two levels under the folder you are in.

## The health figure

The last line of the text report says how many of the folders that have a limit are within it:

```text
✖ 2 errors, 1 warning in 3 folders (119 folders and 842 files checked; 95 % of folders within the limit (113/119)).
```

It is measured before suppressions, with each folder's own limit, in the unit `max-files` counts. It is
never rounded to 100 % while one folder is over. `--stats` in the JSON lists the numbers it comes from
(`used` and `unit` beside `modules`, `files` and `limit`).

## `--format badge`

A [shields.io endpoint](https://shields.io/badges/endpoint-badge): a small JSON with the same
percentage.

```json
{ "schemaVersion": 1, "label": "folders within limit", "message": "95%", "color": "brightgreen" }
```

Colours: 95 % and over `brightgreen`, 90 `green`, 80 `yellowgreen`, 70 `yellow`, 50 `orange`, below
`red`. A repository where no folder has a limit gets a grey `n/a`.

CI writes the file and publishes it anywhere with a public URL (a `badges` branch, GitHub Pages, a
gist):

```sh
npx crowded-folders --format badge=badge.json
```

and the README reads it:

```md
![folders within limit](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOWNER%2FREPO%2Fbadges%2Fbadge.json)
```

`url` is the address of the JSON, URL-encoded. The exit code is that of the check: if the badge is for a
repository that still has problems, write it in a step that is allowed to fail (`|| true`).

## Many tiny files

When a folder over its limit has most of its files tiny, the report adds a note, not a finding:

```text
74 of its 92 files are under 200 bytes: maybe they are one file.
```

The fix for 74 one-line `export type X = Y;` files is to join them, not to spread them over
sub-folders, which is what the rule's usual advice would do. The note is in the text report, the tree
and the page. It needs git: the sizes come from `git ls-tree -r -l HEAD`, that is, from what is
committed; without git, or for a file not committed yet, there is no note. It is a note and not a rule
because a size says how big a file is, not what it is: see
[decisions.md](decisions.md#sizes-are-metadata-never-content).

## How the comparison with the field trial is made

`tooling/field-trial.mjs --docs` writes `src/core/report/tree/trial-data.ts`: how many folders, over
the 36 repositories of the [field trial](field-trial.md), hold exactly 1, 2, 3... modules. "Bigger than
97 %" is the share of those folders that hold fewer modules than yours, rounded down, and the sentence
always says the `n`. The file is written by the tool, never by hand, and the figure changes only when the
trial is run again.
