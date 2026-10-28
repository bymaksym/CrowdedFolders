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
walked, and the run says so; with `--require-git`, the default when `CI` is set, that is an error too.

With `--no-git`, or outside a repository, the disk is walked, skipping `.git` and `node_modules`, and
the `.gitignore` files are read — the root's, the nested ones, and those above the root up to the top
of its repository — by a small matcher of their own syntax. `.gitattributes` is not read there.

With `--stdin`, the list is read from standard input, one path per line (`\n`, `\r\n` or `\r`) or
NUL-separated — which is how the [field trial](field-trial.md) checks a repository without downloading
it: `git ls-tree -r --name-only HEAD | crowded-folders --stdin`. Paths are read from the root; from a
sub-folder, when more of them exist there (as `git ls-files` prints them), they are read from there and
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
inside (`jquery.min.js` is `jquery`), which is rare and harmless.

Then **companions** — regular expressions from the presets — are removed until nothing changes, for
the conventions that mark a companion inside the name: `foo_test.go`, `foo_linux_amd64.go`,
`test_foo.py`, `FooTest.java`, `IFoo.cs`, `User+Codable.swift`. Underscores around the stem go too
(`_tokens.scss`, `__init__.py`). Comparison ignores case: `README.md` and `Readme.txt` are one.

## 4. Words

The stem is split into words in one pass, without regular expressions:

| Stem                                                                         | Words                                                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `user-service`, `user_service`, `userService`, `UserService`, `USER_SERVICE` | `user`, `service`                                                           |
| `HTTPServer`                                                                 | `http`, `server` (an acronym ends at the capital that starts the next word) |
| `i18n-utils`                                                                 | `i18n`, `utils` (digits stay with their letters)                            |
| `2024-01-01-post`                                                            | `2024`, `01`, `01`, `post` (a run of digits is a word)                      |
| `ПользовательСервис`, `用户-服务`                                            | any script, cased or not                                                    |

_Why one pass:_ it runs on every file of repositories with a hundred thousand of them, and a regular
expression with alternatives can backtrack.

## 5. The subject and the group

Leading words in `naming.ignoreLeadingWords` are skipped — `use` of a React hook, `i` of a C#
interface, `bp` of an Unreal blueprint — leaving the **subject**: what the file is about. Its first word
(or first `words` words) is the module's **group**. A subject that starts with a number has no group
unless `groupNumericPrefixes` is on: numbered files are an order, not a family.

## 6. Settings per folder

The configuration, with every preset and `extends` applied in order (each once), is the base. Then
each override whose `folders` glob matches the folder applies, in order. Lists accumulate and `!x`
removes; options merge over the defaults. `crowded-folders explain <folder>` prints the result.

## 7. Rules

Each rule that is on looks at the folder — its files, sub-folders, modules and naming — and reports.
Built-in rules and plugin rules receive exactly the same thing. A finding carries what was measured
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

## What it never does

- **Read file contents.** Only paths. It cannot leak what is in a file, and it is fast.
- **Move anything.** `--moves` prints `git mv` commands; moving breaks imports, and that is the
  author's call.
- **Reach the network.** No telemetry, no update check.
