# How it works

What crowded-folders does with a repository, step by step, and why each step is the way it is. Read
the step before changing it.

## 1. The files

The list comes from git: `git ls-files` for tracked files, plus the untracked ones `.gitignore` does not
hide, minus what was deleted. Submodules are left out (they are another repository). Without git, or
with `--no-git`, the disk is walked, skipping `.git` and `node_modules`. With `--stdin`, the list is read
from standard input — which is how the [field trial](field-trial.md) checks a repository without
downloading it: `git ls-tree -r --name-only HEAD | crowded-folders --stdin`.

Files that `.gitattributes` marks as `linguist-generated` or `linguist-vendored` are left out too, as
git reads them (nested files included): a repository that tells GitHub to fold them in diffs has
already said nobody arranges them by hand.

_Why git:_ `.gitignore` and `.gitattributes` already say what is generated. Reimplementing them would
be a second answer to the same question, and the two would differ.

Then `include` and `exclude` apply. `exclude` matches a path or any folder above it.

## 2. Folders

Every folder that holds a file, and every folder above them, with its files and sub-folders. Paths
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
| `v1.25.1`, `हिन्दी`, `١٢٣-post`                                              | `v1.25.1`; `हिन्दी`; `١٢٣`, `post` (marks and digits of every script)       |
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

Each rule that is on looks at the folder — its files, sub-folders, modules and naming — and reports.
Built-in rules and plugin rules receive exactly the same thing. A rule may also read another rule's
settings in the folder (`prefix-groups` does not propose a folder that `max-files` would report), and
leave a note of what it chose not to report: `explain` lists them under "Not reported, and why". A
finding carries what was measured
(`measured`) and, for groups, the prefix (`key`): together with the folder and the rule they are what a
suppression remembers.

## 8. Suppressions and the exit code

Findings covered by a suppression are dropped if they did not grow; suppressions that nothing needs, or
that remember more than is measured, fail the run until pruned ([adopting.md](adopting.md)). The exit
code is `1` for any error or stale suppression, or more warnings than `--max-warnings`; `2` for a
configuration or command-line problem, which never looks like a clean run.

## What it never does

- **Read file contents.** Only paths. It cannot leak what is in a file, and it is fast.
- **Move anything.** `--moves` prints `git mv` commands; moving breaks imports, and that is the
  author's call.
- **Reach the network.** No telemetry, no update check.
