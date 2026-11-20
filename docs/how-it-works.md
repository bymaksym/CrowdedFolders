# How it works

What crowded-folders does with a repository, step by step, and why each step is the way it is. Read
the step before changing it.

## 1. The files

The list comes from git, in one `git ls-files`: tracked files, plus the untracked ones `.gitignore`
does not hide, minus what was deleted. Submodules are left out (they are another repository), and so is
an untracked repository inside this one. One call, not four: on Windows each git process costs about a
tenth of a second.

Inside a repository, a git that fails (missing from the `PATH`, a broken `GIT_DIR`, "dubious
ownership" in a container) stops the run with exit code 2 and what git said: reading the disk instead
would count what `.gitignore` hides and look like an ordinary run. Outside a repository the disk is
walked, and the run says so; with `--require-git`, the default on CI, that is an error too.

`--tracked-only` leaves out the untracked files git would add. It is the default on CI: a
`test-results/` folder or a report an earlier step left in the checkout is not part of the repository,
and counting it would make the same commit pass on a machine and fail in CI. `--no-tracked-only` brings
them back. It needs git, as `--require-git` does.

With `--no-git`, or outside a repository, the disk is walked, skipping `.git` and `node_modules`, and
the `.gitignore` files are read — the root's, the nested ones, and those above the root up to the top
of its repository — by a small matcher of their own syntax. `.gitattributes` is not read there.

With `--stdin`, the list is read from standard input, one path per line (`\n`, `\r\n` or `\r`) or
NUL-separated — which is how the [field trial](field-trial.md) checks a repository without downloading
it: `git ls-tree -r --name-only HEAD | crowded-folders --stdin`. Paths are read from the root; from a
subfolder, when more of them exist there (as `git ls-files` prints them), they are read from there and
only that folder is checked. An absolute path under the root is made relative to it; one elsewhere is
an error. The same reading applies to `lint({ files })` and `runEngine`.

Files that `.gitattributes` marks as `linguist-generated` or `linguist-vendored` are left out too, as
git reads them (nested files included), also for `--stdin` inside a repository: a repository that tells
GitHub to fold them in diffs has already said nobody arranges them by hand.

Files more than 256 folders deep are left out with a warning: a tree that deep is generated.

_Why git:_ `.gitignore` and `.gitattributes` already say what is generated. Reimplementing them would
be a second answer to the same question, and the two would differ.

Then `include` and `exclude` apply. Both match a path or any folder above it. Given folders
(`crowded-folders src/app`), only the files under them are kept, before anything else is built, and
the summary counts what was checked.

## 2. Folders

Every folder that holds a file, and every folder above them, with its files and subfolders. Paths
are relative to the root, with `/`, whatever the system; the root is `.`.

## 3. Modules

Files that share a **stem** are one module. The stem is the name up to the **first** dot:

```text
user-profile.ts  user-profile.html  user-profile.spec.ts  user-profile.d.ts   → user-profile
Player.cs  Player.cs.meta                                                   → Player
icon.png  icon.png.import                                                   → icon
```

_Why the first dot:_ it joins every companion extension at once (`.spec.ts`, `.component.html`,
`.cs.meta`, `.png.import`) without a list of extensions per ecosystem. The cost is a name with a dot
inside (`jquery.min.js` is `jquery`), which is rare and harmless. Three dots are not cuts, because
cutting there joined files that are each their own thing:

| Name                                            | Stem                                       | Why                                                        |
| ----------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `v1.25.1.md`, `db.changelog-1.3.xml`, `ls.1`    | `v1.25.1`, `db.changelog-1.3`, `ls.1`      | a dot before a number is part of a version                 |
| `[...slug].tsx`, `[[...slug]].tsx`              | `[...slug]`, `[[...slug]]`                 | dots inside brackets are a route segment (Expo, Next.js)   |
| `org.example.Service`, `Elixir.MyApp.User.beam` | `org.example.Service`, `Elixir.MyApp.User` | a reverse package name is one name; it belongs to no group |

Then **companions** — regular expressions from the presets — are removed until nothing changes, for
the conventions that mark a companion inside the name: `foo_test.go`, `foo_linux_amd64.go`,
`test_foo.py`, `FooTest.java`, `IFoo.cs`, `User+Codable.swift`. Underscores around the stem go too
(`_tokens.scss`, `__init__.py`). Comparison ignores case and Unicode normalisation: `README.md` and
`Readme.txt` are one, and so are `diseño` typed on macOS (NFD) and elsewhere (NFC). Not two files
whose whole names differ only in case (`Foo.ts`, `foo.ts`): Linux keeps both, so they are two modules,
and [`case-collision`](rules/case-collision.md) says that they cannot be checked out on Windows or macOS.

Some files are not counted at all, and `explain` lists them with the reason: the files that describe
their folder (`naming.folderFiles`: `package-info.java`, `__init__.py`, `doc.go`, `mod.rs`, Expo
Router's `_layout`) and the files that go with a sibling folder (`naming.folderCompanions`: Unity's
`Scripts.meta` next to `Scripts/`).

## 4. Words

The stem is split into words in one pass, without regular expressions:

| Stem                                                                         | Words                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `user-service`, `user_service`, `userService`, `UserService`, `USER_SERVICE` | `user`, `service`                                                           |
| `HTTPServer`                                                                 | `http`, `server` (an acronym ends at the capital that starts the next word) |
| `i18n-utils`                                                                 | `i18n`, `utils` (digits stay with their letters)                            |
| `2024-01-01-post`                                                            | `2024`, `01`, `01`, `post` (a run of digits is a word)                      |
| `getURLs`, `userIDs`, `APIs`                                                 | `get`, `urls`; `user`, `ids`; `apis` (an acronym's plural s stays with it)  |
| `II18nKey`                                                                   | `i`, `i18n`, `key` (a capital before a word with digits is a word)          |
| `OAuthClient`, `iOSApp`, `macOS`, `eBay`                                     | `oauth`, `client`; `ios`, `app`; `macos`; `ebay` (a short list of names)    |
| `v1.25.1`, `हिन्दी`, `١٢٣-post`                                               | `v1.25.1`; `हिन्दी`; `١٢٣`, `post` (marks and digits of every script)        |
| `ПользовательСервис`, `用户-服务`                                            | any script, cased or not                                                    |

_Why one pass:_ it runs on every file of repositories with a hundred thousand of them, and a regular
expression with alternatives can backtrack.

## 5. The subject and the group

A single capital glued to a capitalised word is a type letter and is skipped: the `I` of
`IUserService` and `II18nKey`, the `T` of `TProps`, the `A` of `AActor`. Then the leading words in
`naming.ignoreLeadingWords` are skipped — `use` of a React hook, `bp` of an Unreal blueprint — leaving
the **subject**: what the file is about. Its first word (or first `words` words, or with `"auto"` the
longest prefix that keeps the group) is the module's **group**. Singular and plural are one word
there: `UsersController` is in the group `user` with `UserGroups`, and the key is written with the
singular when the folder has it. A subject that starts with a number has no group unless
`groupNumericPrefixes` is on: numbered files are an order, not a family.

The plural comes from a small English inflector (`-s`, `-es`, `-ies`, and a list of irregulars such
as `children`), with a list of words that only look plural (`news` is not more than one `new`).

## 6. Settings per folder

The configuration, with every preset and `extends` applied in order (each once), is the base. Then
each override whose `folders` glob matches the folder applies, in order. Lists accumulate and `!x`
removes; options merge over the defaults. `crowded-folders explain <folder>` prints the result.

## 7. Rules

Each rule that is on looks at the folder — its files, subfolders, modules and naming — and reports.
Built-in rules and plugin rules receive exactly the same thing. A rule may also read another rule's
settings in the folder (`prefix-groups` does not propose a folder that `max-files` would report), and
leave a note of what it chose not to report: `explain` lists them under "Not reported, and why". A
finding carries what was measured
(`measured`) and, for groups, the prefix (`key`): together with the folder and the rule they are what a
suppression remembers.

## 8. Suppressions and the exit code

Findings covered by a suppression are dropped if they did not grow; suppressions that nothing needs, or
that remember more than is measured, fail the run until pruned ([adopting.md](adopting.md)). A run over
some folders (`crowded-folders src/lib`, `--since`) looks only at the suppressions of the folders it
checked. With `--new-since <ref>`, the same check runs over the base's file names (`git ls-tree`), and a
finding the base already had, as big or bigger, does not fail. The suppressions file and the `--output`
file are never among the files. The exit code is `1` for any error or stale suppression, or more
warnings than `--max-warnings`; `2` for a configuration or command-line problem, which never looks like a
clean run. The text summary is written from the same decision, so its mark always matches the code.

## 9. Moves

`prefix-groups` and `redundant-prefix` say where their files could go (`moves`), read from the folder's
naming: the folder written as the language writes packages (`naming.folderCase`), never a keyword
(`naming.reservedWords`), a route group where the path is the address (`naming.routes`), nothing a
tool reads by name and place (`naming.keepInPlace`), and never onto a path that exists, compared
without case. A tree that mirrors another (`naming.mirrors`: `src/test/java` of `src/main/java`,
`__tests__`) is folded into it after the rules run: the problem both have is reported once, in the
source, and its moves take the mirror's files of the same modules along; a run over some folders reads
their mirrors too, so it folds the same way. With `--moves`, the command — not the core — searches
the tracked files for the paths a group moves, to say which would break.

## What it never does

- **Read file contents.** Only paths. It cannot leak what is in a file, and it is fast.
- **Move anything.** `--moves` prints `git mv` commands; moving breaks imports, and that is the
  author's call.
- **Reach the network.** No telemetry, no update check.
