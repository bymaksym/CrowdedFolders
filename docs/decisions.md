# Decisions

Why crowded-folders is built the way it is: what was decided, why, and what was discarded. The
discarded half is the one that saves a discussion a year from now.

## A command, not an ESLint rule

**Decided:** a standalone command, with plugins of its own.
**Why:** an ESLint rule looks at one file and caches per file; this compares siblings, so a rule would
have to read the folder from inside, and an unchanged file would not be re-checked when a sibling
appears. And it has to work for Go, Python, Unity and LaTeX repositories, which do not run ESLint.
**Discarded:** an ESLint plugin as the only form. A thin wrapper can come later, on top of the API.

## The file list comes from git

**Decided:** `git ls-files` (tracked plus untracked-not-ignored), the disk without git, or `--stdin`.
What `.gitattributes` marks `linguist-generated` or `linguist-vendored` is left out, as git reads it.
**Why:** `.gitignore` and `.gitattributes` already say what is generated; a second implementation would
be a second answer.
`--stdin` lets the field trial check dozens of repositories without downloading their contents.
A git that fails inside a repository is an error, never a quiet fall back to the disk.
**Discarded:** reimplementing `.gitignore` as the source of the list. Without git (`--no-git`, or no
repository), a small matcher reads the `.gitignore` files, because walking the disk without them
counts `build/` and is a worse answer than an approximate one; with git, git answers.

## The root is never the current folder

**Decided:** the root is the configuration's folder, else the top of the git repository. With
`--root`, the configuration is looked for from the root, and its patterns keep starting at its own
folder. Paths on the command line start from the current folder, as in most commands.
**Why:** the same command typed from a sub-folder must check the same thing. A tool whose answer
depends on where it was typed gives two answers; a pattern that means another folder depending on
`--root` gives two answers too.

## Modules, not files

**Decided:** limits count modules (a file with its companions), cut at the first dot.
**Why:** an Angular component is four files and a Go file is one; counting files would make Angular
folders "crowded" at a quarter of the size. The first dot joins every companion extension
(`.spec.ts`, `.cs.meta`, `.png.import`) without a list per ecosystem.
**Discarded:** the last dot plus a list of known double extensions — a list that is never complete.

## The limits are measured, or quoted

**Decided:** 20 modules is about the median 95th percentile (19) over 36 repositories ([field-trial.md](field-trial.md)).
A preset only changes it when its ecosystem's guide gives a number, and quotes it.
**Why:** a limit that is an opinion dressed as a standard is ignored at the first disagreement. Eight
presets had 15 before the trial, with no source; they were removed.
**Discarded:** one number for everything; a number per preset without a source.

## Every exception carries its reason

**Decided:** `reason` is required on overrides, the configuration does not load without it, and an
override that matches nothing is reported.
**Why:** an exception without a reason cannot be reviewed, and nobody knows a year later whether it
still holds. A silence that silences nothing rots.

## Suppressions that only go down

**Decided:** ESLint's bulk-suppression model (`--suppress-all`, `--prune-suppressions`), plus: a
suppressed number may not grow, and a suppression that remembers more than is measured fails until
pruned.
**Why:** adopting the tool must not require reorganising a repository first — but a suppression that
can quietly climb back is not a ceiling.
**Discarded:** a baseline that only stops new folders (an old folder could double); warnings instead
of errors (warnings are read for a week).

## A change is compared by names, not by `git diff`

**Decided:** `--since`, `--changed` and `--new-since` read the base's file names with `git ls-tree` and
compare them with the run's own list; what was added or removed reshapes its folder, and files that left
one folder for another with the same names mark it as moved. `--base`, which only chooses the file an
annotation goes on, reads its ref the same way (and defaults to theirs, or to the pull request's): one
way of reading a ref, not three.
**Why:** the run's list already has the untracked files `git diff` leaves out, and the comparison is the
same with `--stdin`; names are all the check reads, so the base needs no checkout and a clone of depth 1
is enough. A run over some folders judges only their suppressions: it says nothing about the rest.
**Discarded:** `git diff --name-status -M`, whose content-based renames the check does not need; and
pruning, with folders, everything the run did not see — which emptied the file on the recipe this
documentation gave.

## A group is something to move, not the folder itself

**Decided:** `prefix-groups` does not propose a group that holds 85 % of the folder's modules or
more, nor one that would be over `max-files`' limit on its own. A folder over the limit can still
get both findings when it has a real group: one says it is too big, the other where to cut — never
both about the same modules.
**Why:** in a folder of 93 interfaces, moving 92 into `ext/` adds a level and leaves a folder as
crowded as before, and the folder came out twice. Above roughly 85 % the prefix is what the folder
is about: rename the folder, or drop the prefix from the names. The share is a judgement, not a
measured limit; at 4 to 6 modules it lets 4 of 5 and 5 of 6 through.
**Discarded:** joining the two findings into one (each has its own suppression key); hiding
`prefix-groups` wherever `max-files` fires (the group is the way out).

## Case collisions are their own rule, off by default

**Decided:** modules are joined across case and Unicode normalisation when their stems match, except
two files whose whole names differ only in case; `case-collision` reports names that are one on
Windows and macOS. It is off in `recommended` and on in `strict`.
**Why:** whether `Foo.ts` and `foo.ts` are one file depends on the disk, and the answer must not
depend on the machine it runs on: so they are counted as Linux keeps them, and named as a problem
for the others. A new rule on in `recommended` would be a breaking change (see below).

## Presets carry their sources

**Decided:** a preset has `sources`, and the conventions that contradict the tool win: Vue's flat
`components/`, Android's `res/`, Go's packages.
**Why:** a tool that fights an ecosystem's own guide is uninstalled, rightly.

## Zero runtime dependencies

**Decided:** none: the glob matcher, the JSONC reader and the schema validator are a few hundred lines
here.
**Why:** `npx` installs nothing, there is nothing to audit, and it runs in a Python repository's CI as
easily as in a Node one.
**Discarded:** `picomatch`, `ajv`, `jsonc-parser` — each fine, each a dependency for one function.

## One schema, two uses

**Decided:** the JSON Schema published as `schema.json` is the one the configuration is checked against.
**Why:** a schema for editors and a validator for the command would drift; one would accept what the
other rejects.

## Node 20.19 and later

**Decided:** `^20.19.0 || ^22.13.0 || >=24`, ESLint 10's range; TypeScript's `lib` is ES2023 and
`eslint-plugin-n` reads `engines`, so a newer API fails before CI's Node 20.19 job does.
**Why:** a minimum that nothing runs is a promise kept by luck.

## Sizes are metadata, never content

**Decided:** the tool judges folders by names. The one thing beyond names it uses is a file's size in
bytes, from `git ls-tree -r -l HEAD`, which git keeps in its records: no file is opened. With it, a
folder over its limit whose files are mostly under 200 bytes gets a note ("74 of its 92 files are under
200 bytes: maybe they are one file"), in the text report, `tree` and the HTML map.
**Why:** 74 of the 92 files of a folder were one line (`export type IExtAssetType = ICatalogValue;`),
and the fix is to join them, which the usual advice (split by what the files are about) gets backwards.
A size answers that without the cost or the risk of reading content: the core stays pure, a huge
repository costs one `git` call, and nothing in a file can change the result.
**Discarded:** a rule. A size says how big a file is, not what it is (generated stubs, a licence per
file), so it is a note beside the finding and never fails a run. Reading the files to count lines: it
would make the tool slower and its answer depend on content, which is what looking at names avoids.
Sizes of the working tree: untracked or edited files have no committed size; the note is for what is in
`HEAD`.

## No moves applied

**Decided:** `--moves` prints `git mv` commands and never moves anything.
**Why:** moving a file breaks every import of it; whether that is worth it is the author's call.

## Moves that build, or none

**Decided:** a move follows the ecosystem (case, keywords, route groups, Rust's `render.rs`, the files
a tool reads in place, mirrored test trees), drops the prefix the new folder says unless the file is
named after its type, and never lands on a path that exists, even in other case. Each group's commands
make its folder first, and `--moves=sh|pwsh|json` prints only them.
**Why:** a command that fails, or a move that stops the project from building, is copied by people and
by agents exactly as printed; one wrong suggestion and the rest are not trusted.
**Discarded:** offering both names (`render/render-json.ts` and `render/json.ts`): a script runs one,
and the presets know which their ecosystem wants. Searching the references in the core: it reads no
file's contents, so the command does it and hands the core the list.

## What a version promises

**Decided:** a change that makes the default configuration find more is a breaking change, released
in a major version: a new preset that is detected, a lower limit, a rule turned on in `recommended`, a
word that now groups. Its commit is marked breaking (`feat!:`). A change that only finds less (a false
positive removed) is a fix or a feature. The first version is 1.0.0, so this holds from the start. The
documentation names an exact version, and the Action runs the version it was released with.
**Why:** presets are detected, so a repository with no configuration changes behaviour on update
without touching anything, and the ones that run the tool in CI find out when their build turns red.
This is how ESLint treats `eslint:recommended`.
How names are read is part of this. A suppression remembers the folder, the rule and the group's
key, so a change in how a name is split or grouped changes keys: `getURLs` used to be `get ur ls`,
`IProfile` was in the group `i` and is now in `profile`, `UsersController` joins the key `user`, a
type letter or a version is read differently. A group can also grow (`modals` now joins `modal_*`), and a suppression whose number grew fails. Such a change is released as a fix when it only removes
false positives; its suppressions become stale and `--prune-suppressions` drops them. When it makes a
new group appear, it is breaking like any other.
**Discarded:** starting at 0.x, where breaking changes go out in minors that `@0` lets in; recommending
`@latest` in CI; relying on `init` alone, since a preset's contents
change between versions even when its name is written down.
