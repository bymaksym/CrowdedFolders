# Adopting crowded-folders in a repository that already has problems

The first run on a repository of some age finds problems — the [field trial](field-trial.md) found
errors in 22 of 30 well-known projects. Reorganising everything before turning the check on is how such
a check never gets turned on. There are two other ways: record today's problems in a file
(suppressions), or let CI fail only on what a pull request makes worse (`--new-since`).

## Suppressions

```sh
npx crowded-folders init               # write the configuration
npx crowded-folders --suppress-all     # record today's errors and pass
```

`--suppress-all` writes `crowded-folders-suppressions.json` at the root, and says what it wrote:

```text
Wrote crowded-folders-suppressions.json: added 2; it holds 2 suppressions in 2 folders. Commit it.
  + cli  prefix-groups#render  at 5
  + src/components  max-files  at 34
```

```json
{
    "version": 1,
    "suppressions": {
        "cli": { "prefix-groups#render": { "count": 5 } },
        "src/components": {
            "max-files": {
                "count": 34,
                "reason": "split after the 2.0 release",
                "owner": "@web",
                "expires": "2027-01-31"
            }
        }
    }
}
```

`reason`, `owner` and `expires` (a date, `YYYY-MM-DD`) are yours: the tool keeps them as written through
`--prune-suppressions` and `--suppress-all`, and does not act on them. Any other field is an error, so a
misspelt one is not silently lost. Folder keys are read the way paths are (`src/lib/`, `./src/lib` and
`src\lib` are `src/lib`), and a folder called `__proto__` or `constructor` is a folder like any other.

Commit it. From then on:

| What happens                                      | The run                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| A new crowded folder, or a new group              | fails                                                                          |
| A suppressed folder grows (35 > 34)               | fails, saying it was suppressed at 34                                          |
| A suppressed folder stays the same                | passes                                                                         |
| A suppressed folder gets better (30 < 34)         | **fails**, under **Progress** (`src/components 34 → 30`), until it is saved    |
| A suppressed problem is fixed                     | **fails** until `--prune-suppressions`                                         |
| A suppressed folder was renamed or moved          | fails: the new folder's problem says it "looks moved from" the old one         |
| A suppression names a rule that does not exist    | fails: "`no-such-rule` is not a rule", never "fixed"                           |
| A suppression names a folder with no checked file | fails: "the folder does not exist" (with "did you mean" for a case difference) |

The progress and fixed lines are on purpose. Without them, `src/components` could go down to 30 and
quietly climb back to 34. `--prune-suppressions` lowers each count to what is measured and removes what
is fixed, so the file only ever shrinks; the diff of that file is the progress. It says what it changed:

```text
Pruned crowded-folders-suppressions.json: lowered 1, removed 1; it holds 1 suppression in 1 folder. Commit it.
  − cli  prefix-groups#render  (was 5)
  ↓ src/components  max-files  34 → 30
```

A renamed folder's suppression is not carried over by itself — the match is a guess (the same rule,
prefix and number, or the files that left one folder arriving in another): rename its key in the file,
and its notes go with it.

The summary line follows the exit code: a run that fails ends in `✖` and says why (`✖ 1 suppression to
prune`), never in a green "No crowded folders".

## Checking some folders

`crowded-folders src/lib` looks at `src/lib` and what is under it, and only at **their** suppressions: the
others are neither "fixed" nor pruned, because a run over some folders says nothing about the rest.
`--prune-suppressions` with folders prunes only theirs. The same holds for `--since` and `--changed`
([ci.md](ci.md#only-what-a-pull-request-changed)): they check the folders a change reshaped, and leave the
suppressions of every other folder alone.

## Without a suppressions file: `--new-since`

```sh
npx crowded-folders --new-since origin/main
```

checks the whole repository but fails only on problems that are **new, or grew**, since `origin/main`.
A problem the base already had, at the same size or bigger, is counted ("3 problems already on
origin/main") and passes. Only file names are compared, and git gives the base's names without a checkout
(`git ls-tree`), so it works in a clone of depth 1 as long as the base was fetched. When git finds the
merge base it compares with it (where the branch started); in a shallow clone it compares with the tip of
the base, and says so.

Which one:

- **Suppressions** when the debt should be visible and go down: the file is reviewed, has owners, and
  every improvement is recorded.
- **`--new-since`** when nobody wants a file: nothing gets worse, nothing is recorded. A folder that
  improves can grow back up to what the base had.

## One file per project

In a monorepo, one file at the root is touched by every team: merge conflicts, one owner in CODEOWNERS.
With

```json
{ "suppressions": "per-project" }
```

each project keeps its own `crowded-folders-suppressions.json`, its keys relative to the project. A
folder's suppressions go to the nearest folder at or above it that has a suppressions file or a project
manifest (`package.json`, `project.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle(.kts)`,
`pyproject.toml`, `composer.json`, `pubspec.yaml`, `mix.exs`, `BUILD.bazel`), else the root. Suppressions
already in a file stay in it. The same suppression in two files is an error.

## The flags

| Flag                              | Does                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--suppress-all`                  | Adds a suppression for every current **error** (warnings never fail, so they are not kept). Keeps the existing ones. |
| `--suppress-rule <rule>`          | The same for one rule; repeatable.                                                                                   |
| `--prune-suppressions`            | Removes suppressions nothing needs and lowers those that went down.                                                  |
| `--pass-on-unpruned-suppressions` | Does not fail on stale suppressions (for a branch that is mid-refactor).                                             |
| `--suppressions-location <file>`  | Another file, or `per-project`; or `"suppressions"` in the configuration.                                            |
| `--new-since <ref>`               | Fails only on problems that are new or grew since `<ref>`.                                                           |
| `--force`                         | With `CI` set, lets `--suppress-all`, `--suppress-rule` and `--prune-suppressions` write.                            |

With `CI` set, the three flags that write refuse to (exit code 2) unless `--force` is given: a CI job that
writes its own suppressions passes, and the file it wrote is never committed, so the pull request shows
nothing. Run them on your machine and commit the result.

The suppressions file and the `--output` file are never counted as files checked: writing them must not
change what the next run measures.

The names and the behaviour are those of ESLint's bulk suppressions, on purpose: a team that knows one
knows the other.

## Suppressions or overrides?

- **A suppression** is a debt: this folder is too big _today_, and nobody may make it bigger.
- **An override** is a decision: this folder is big _on purpose_ (generated code, a design-system
  catalogue, a flat folder the framework requires), with the reason written next to it.

If you find yourself pruning a suppression that will never move, it is an override.
