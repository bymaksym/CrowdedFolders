# `prefix-groups`

At least `min` modules whose names start with the same word belong in a folder named after it.

**On in `recommended`:** error, 4 modules. Options and defaults: [configuration.md](../configuration.md#prefix-groups).

<!-- output: prefix-groups -->

```text
cli/
  ✖ error  prefix-groups  5 modules start with "render" (render-json, render-markdown, render-pr,
                          render-sarif, render-text): they are a folder that was never made —
                          cli/render/.

✖ 1 error, 0 warnings in 1 folder (2 folders and 7 files checked; 100 % of folders within the
  max-files limit (2/2)).
  --moves prints where each file could go; `crowded-folders explain cli` shows how a folder was
    read.
```

<!-- /output -->

The prefix is doing the job a directory should. Once they are in `cli/render/`, the folder says
"render" once and the names get shorter (see [`redundant-prefix`](redundant-prefix.md)).

## The fix

<!-- fix: prefix-groups -->

`--moves` prints the fix. The folder after it, and the run that passes:

```sh
mkdir -p cli/render
git mv cli/render-json.ts cli/render/json.ts
git mv cli/render-markdown.ts cli/render/markdown.ts
git mv cli/render-pr.ts cli/render/pr.ts
git mv cli/render-sarif.ts cli/render/sarif.ts
git mv cli/render-text.ts cli/render/text.ts
```

```text
cli/ args.ts, main.ts
cli/render/ json.ts, markdown.ts, pr.ts, sarif.ts, text.ts

✔ No crowded folders (3 folders and 7 files checked; 100 % of folders within the max-files limit
```

<!-- /fix -->

## How the prefix is read

1. The **stem** of each file: its name up to the first dot, without companions (`render-json.spec.ts`
   is `render-json`).
2. Its **words**, in any convention: `render-json`, `render_json`, `renderJson` and `RenderJson` are all
   `render`, `json`. Acronyms end where the next word starts: `HTTPServer` is `http`, `server`.
3. A type letter is skipped (`I` of `IUserService`, `T` of `TProps`), and so are the leading words
   that say nothing (`naming.ignoreLeadingWords`): `use` of React hooks, `bp` of Unreal blueprints.
4. The first word (or the first `words` words) is the group, singular and plural as one word
   (`UsersController` is with `UserGroups`). With `words: "auto"` the key grows while one longer
   key keeps `min` modules and more than half of the group: eight `RegistroHorario*` and one
   `RegistroUsuarioConRol` are `registro-horario`.

Modules, not files, are counted: `render-json.ts` and `render-json.spec.ts` are one.

## When it stays quiet, and why

| Case                                                                     | Example                                                                                                        | Why                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The prefix is the folder's name, or a folder's above it (plural allowed) | `render/render-json.ts`, `hooks/hook-x.ts`, `ColorPicker/ColorInput.tsx`, `toolbar/testing/toolbar-harness.ts` | They are already where they belong.                                                     |
| The folder glues the words                                               | `feature/dayplan/DayPlanList.kt`                                                                               | `dayplan` is `day` and `plan` written as a package name.                                |
| Every module of the folder shares it, or 85 % of them                    | `tooling/check-a` … `check-d` and nothing else; 92 of 93 `IExtAsset*`                                          | Moving everything down one level only adds a level; maybe rename the folder.            |
| The group alone would be over `max-files`                                | 25 `user-*` with a limit of 20                                                                                 | The new folder would be as crowded; group by more words.                                |
| The prefix is in `ignore`                                                | `test`, `tests`, `spec`, `get`, `set`, `is`, `has`, `can`, `should` in `recommended`                           | `GetAlbum`, `IsPlayed`, `test_parser` are not about "get", "is" or "test".              |
| The name starts with a number                                            | `0001_initial.py`, `2024-01-01-post.md`                                                                        | Numbers order things; they do not group them. `naming.groupNumericPrefixes` changes it. |
| The rest of each name is a language                                      | `README-ja`, `README-ko`, `README-ru`, `README-zh` (bat); `strings_ar` … `strings_zh` (localsend)              | One document in several languages is not a family of topics.                            |
| Every module is the prefix, a number and a title                         | `ADR-001-Use-EFCore-In-Application-Layer`, `ADR-002-…` (CleanArchitecture)                                     | A numbered series is kept flat and in order, like migrations.                           |
| Fewer than `min`                                                         | three `user-*` modules                                                                                         | Three is a coincidence; four is a family with a name.                                   |

Each case was a false positive found in the [field trial](../field-trial.md) or in use.
`crowded-folders explain <folder>` lists, under "Not reported, and why", every group of two or more
that was left out and which of these cases it is.

## Options

| Option       | Default                                                                         |                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `min`        | `4`                                                                             | How many modules make a group. `strict` uses 3; `c-cpp` 5; game presets 15 (Allar's style guide, rule 2.7).                                              |
| `words`      | `1`                                                                             | How many leading words form the prefix. With 2, `user-list-*` and `user-card-*` are two groups; `"auto"` takes the longest that keeps the group.         |
| `ignore`     | `[]` (and `test, tests, spec, get, set, is, has, can, should` in `recommended`) | Prefixes that never group, lowercase, words joined with `-`. An entry that can never match (`render_json`) stops the configuration, with the form meant. |
| `hint`       | `""`                                                                            | Added to the message: what a folder costs in this ecosystem.                                                                                             |
| `hintFor`    | `[]`                                                                            | Globs of file names: the hint is added only when the files of the group include one (`*.java`). Default: always.                                         |
| `dropPrefix` | `true` (`false` in java, dotnet, php, swift, angular, nestjs, flutter, unreal)  | Whether a move drops the prefix the new folder says: `render-json.ts` → `render/json.ts`. Off where a file is named after the type it holds.             |

## Where a folder is not free

A group is reported as a **warning** with a hint where making a folder changes more than the tree:
`go` (a folder is a package), `terraform` (a module), `rails` in `app/models` (a namespace), `docs`
in `docs/`, `doc/` and `blog/` (moving a page changes its URL). Under Next.js's `app/` and SvelteKit's `src/routes` the hint says to
use a private folder (`_name`) or a route group (`(name)`), which group files without changing URLs.

## Moves

`--moves` prints, under each group, the `mkdir -p` of its folder and a `git mv` for every file of it,
and the tracked files whose text names one of those paths: they are what the move breaks besides the
imports. They are suggestions only: nothing is ever moved, and whether it is worth it is the author's
call. `--moves=sh`, `--moves=pwsh` and `--moves=json` print only the moves, to review and run from
the root:

```sh
$ npx crowded-folders --moves=sh
# src: prefix-groups "render" — 2 files name these paths: package.json, tooling/check.mjs
mkdir -p src/render
git mv src/render-json.ts src/render/json.ts
git mv src/render-text.ts src/render/text.ts
```

Where a file goes is read from the ecosystem, because a move that does not build is worse than none:

| Case                                                     | What the move does                                                                                      | Set by                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| The folder repeats the prefix                            | `render-json.ts` → `render/json.ts`, `test_render_json.py` → `render/test_json.py`                      | `dropPrefix` (off where the file is named after its type)   |
| How the folder is written                                | `UserRole/` in C# and PHP, `userrole/` in Java and Go, `user_role/` in Python, Rust, Dart, Ruby, Elixir | `naming.folderCase`                                         |
| The name is a keyword                                    | `core/abstracts/`, not `core/abstract/` (`package com.a.core.abstract` does not compile)                | `naming.reservedWords`, per language                        |
| A tool reads the file by name and place                  | Spring's `application-dev.yml`, Flutter's `main_dev.dart`, patch-package's `patches/*.patch` stay       | `naming.keepInPlace`                                        |
| The path is the address (Expo Router, Next.js `app/`)    | `app/sign-in.tsx` → `app/(sign)/sign-in.tsx`: a route group keeps `/sign-in`                            | `naming.routes`                                             |
| Rust                                                     | `render.rs` stays beside `render/`, which it declares; `render_json.rs` → `render/json.rs`              | `naming.groupFileStays`                                     |
| The tests mirror the code (`src/test/java`, `__tests__`) | one problem, in the code, and the tests move with it                                                    | `naming.mirrors`                                            |
| The folder exists                                        | "move them into the src/render/ that already exists"                                                    | always                                                      |
| The new name is taken, or differs only in case           | the module keeps its name, or stays, and the message says why                                           | always: `text.ts` overwrites `Text.ts` on Windows and macOS |
