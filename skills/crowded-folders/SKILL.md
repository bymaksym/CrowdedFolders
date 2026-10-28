---
name: crowded-folders
description: Keeps folders from becoming a drawer. Use it before adding a file to a folder that already holds many, when a new file's name starts like several others, after moving or adding files, and when a folder is reported as crowded or the user asks to reorganise one. It says where a new file fits, what a folder's problem is, and writes the reorganisation task.
---

# crowded-folders

`crowded-folders` finds the folders of a repository that have become a drawer: too many files in one
place (`max-files`), or several files whose names start with the same word that are a folder nobody made
(`prefix-groups`: `render-json.ts`, `render-text.ts`, `render-sarif.ts`, `render-pr.ts` want a `render/`).
Run it with `npx crowded-folders`. It reads the repository's own configuration, so its limits are the
project's, not yours: do not guess them and do not change them.

## Before you add a file

Ask where it fits, with the path you are about to create (the file need not exist):

```sh
npx crowded-folders where src/core/enums/foo-bar.enum.ts
```

Read the first line under the path:

| It says                             | It means                                                                                | You do                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `OK`                                | The folder has room and no rule is hurt.                                                | Create the file.                                                                     |
| `OK, and src/ui/navbar/ exists`     | The folder is fine, but an existing subfolder is named like the start of the file name. | Put the file in that subfolder, unless there is a reason not to.                     |
| `WORSE max-files 14->15 (limit 10)` | The folder is over its limit already and the file adds one (before -> after).           | Do not add to it. Use a candidate folder below, or a new subfolder for a real topic. |
| `CREATES max-files 11 (limit 10)`   | The folder is fine now and the file would be the one that tips it over.                 | The same: look at the candidates first.                                              |
| `CREATES prefix-groups "render"`    | The file is the fourth that starts with `render`: the group is a folder to make.        | Make the folder the `Move:` line names and put the file there.                       |
| `BETTER`                            | The file fixes a problem (a folder with a single file gets its second).                 | Create it.                                                                           |
| `EXISTS`, `UNCHECKED`               | The file is there already, or the configuration or `.gitignore` leaves the place out.   | Nothing to do.                                                                       |

Under the verdict come the rule's message, the folders that fit (`<folder>/ exists ...`), the move the
rule would make (`Move: git mv ...`), and the group the file joins (`It joins the group "navbar-*" with 3
modules; prefix-groups asks for a folder at 4`): at that point a folder is already worth making.

A warning is advice, not a gate. If the file does belong in a crowded folder, say why in your answer.
`--fail-on worse` makes the command exit 1 for `CREATES` and `WORSE`; `-f json` gives the same as data.

If the project installed the hook (`npx crowded-folders init --agents`), you get these lines as context
when you write a new file, and nothing is blocked.

## After you add or move files

```sh
npx crowded-folders            # the whole repository; exit 0 clean, 1 errors
npx crowded-folders src/core   # only some folders
```

Each problem is a folder, a rule, a number against a limit and, with `--moves`, the `mkdir` and `git mv` to
fix it and the files that name the moved paths. `--moves` only prints: it never moves anything.
Run it before you say the work is done. A new error that was not there before is yours to fix.

## A folder that is crowded

Ask for the task instead of improvising the moves:

```sh
npx crowded-folders explain src/core/enums --prompt
```

It prints the folder, its modules, the groups and the near-groups, the proposed moves, the files that
name the paths to move, and the steps: `git mv` the files, update every import and path, run the type
check and the tests, run the tool again. Do what it says, in that order. `npx crowded-folders explain
<folder>` (without `--prompt`) says how each file name was read and why a folder is or is not reported.

## What not to do

- Do not raise `max`, turn a rule off, add an `overrides` entry or a suppression to make a report go away.
  If a limit is wrong for the project, say so to the user: that is their decision, and an override needs a
  `reason`.
- Do not move files with a shell loop of your own; use `git mv`, so the history follows, and fix the imports.
- Do not split a folder only to get under the number: the files of a new folder must be about one thing.
