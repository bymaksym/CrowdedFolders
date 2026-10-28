# In CI and in hooks

crowded-folders reads file names only and has no dependencies, so it runs anywhere Node 20.19+ runs,
in half a second on a repository of 14,000 files (the Godot engine, measured).

**Pin an exact version.** Only a major version finds more than the one before (a new preset, a lower
limit: [decisions.md](decisions.md#what-a-version-promises)), but a pinned run is one you can repeat. The
examples below name the latest release and are updated with each one. Two ways to keep up without
surprises: install it as a devDependency, so the lockfile pins it and your dependency bot proposes
updates; or use the Action pinned by tag or SHA, which runs the version it was released with.

## Exit codes

| Code | Means                                                                                 |
| ---- | ------------------------------------------------------------------------------------- |
| `0`  | No errors, no stale suppressions, and no more warnings than `--max-warnings`.         |
| `1`  | Problems.                                                                             |
| `2`  | The configuration or the command line is wrong, or the tool broke. Never a clean run. |

The last line of the text report follows the exit code: `✔` only on `0`, and on `1` it says what failed —
errors, `N suppressions to prune`, or `over --max-warnings` (warnings `--quiet` hid included).

`--suppress-all`, `--suppress-rule` and `--prune-suppressions` refuse to write when `CI` is set (exit code
`2`): a job that writes its own suppressions passes and leaves nothing in the pull request. Run them on a
machine and commit the file; `--force` is for a job that means it.

## Output formats

| `--format` | For                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------- |
| `text`     | People (default). Colours in a terminal; `NO_COLOR`, `FORCE_COLOR`, `--color`, `--no-color`. |
| `github`   | GitHub Actions annotations, on the first file of each folder.                                |
| `sarif`    | GitHub code scanning and other SARIF viewers.                                                |
| `markdown` | A pull-request comment or `$GITHUB_STEP_SUMMARY`.                                            |
| `json`     | Scripts. Fields are only ever added in a minor version.                                      |

`--output <file>` writes the report to a file instead of standard output.

## GitHub Actions

The plainest form, with annotations on the pull request:

<!-- x-release-please-start-version -->

```yaml
name: Structure
on: [push, pull_request]
jobs:
    crowded-folders:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
            - uses: actions/setup-node@v7
              with: { node-version: 24 }
            - run: npx --yes crowded-folders@1.0.0 --format github
```

<!-- x-release-please-end -->

With a summary on the job page and SARIF for code scanning:

<!-- x-release-please-start-version -->

```yaml
- run: npx --yes crowded-folders@1.0.0 --format markdown >> "$GITHUB_STEP_SUMMARY"
  continue-on-error: true
- run: npx --yes crowded-folders@1.0.0 --format sarif --output crowded-folders.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v4
  with: { sarif_file: crowded-folders.sarif }
- run: npx --yes crowded-folders@1.0.0 --format github # the step that passes or fails
```

<!-- x-release-please-end -->

Or the action in this repository, which does the same and runs the crowded-folders version it was
released with, so pinning the action pins the tool (`version` runs another):

<!-- x-release-please-start-version -->

```yaml
- uses: bymaksym/CrowdedFolders@v1.0.0
  with:
      args: --max-warnings 0 # anything the command takes
      summary: true # add the Markdown report to the job summary
```

<!-- x-release-please-end -->

## GitLab CI

<!-- x-release-please-start-version -->

```yaml
crowded-folders:
    image: node:24
    script:
        - npx --yes crowded-folders@1.0.0
```

<!-- x-release-please-end -->

For a merge-request widget, GitLab reads Code Quality reports, not SARIF; use `--format json` and
convert, or keep the job log.

## Other CI (Azure Pipelines, Jenkins, CircleCI, Buildkite…)

Any step that can run Node: `npx --yes crowded-folders@1.0.0`. The exit code does the rest. <!-- x-release-please-version -->

## Only what a pull request changed

Two flags compare with a base, and both read only file names: git lists the base's names
(`git ls-tree`) without checking it out.

| Flag                            | Checks                                                            | Fails on                                       | Use it when                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--since <ref>`, or `--changed` | only the folders the change reshaped, and only their suppressions | any problem in them, as a normal run would     | you keep a suppressions file and want the pull request to answer for the folders it touched, and only those   |
| `--new-since <ref>`             | the whole repository                                              | problems that are new, or grew, since the base | you adopt it without a suppressions file ([adopting.md](adopting.md#without-a-suppressions-file---new-since)) |

A folder is **reshaped** when a file was added to it or removed from it, or a sub-folder of it appeared
or went; a moved file reshapes its old folder and its new one. A file edited in place reshapes nothing:
the check is about names. Suppressions of folders that were not reshaped are left as they are — never
"fixed", never pruned — so `--prune-suppressions` with `--since` is safe.

`--changed` is `--since` the base of the pull request, read from the CI: `GITHUB_BASE_REF` (GitHub
Actions), `CI_MERGE_REQUEST_DIFF_BASE_SHA` or `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (GitLab),
`BITBUCKET_PR_DESTINATION_BRANCH`, `SYSTEM_PULLREQUEST_TARGETBRANCH` (Azure Pipelines), `CHANGE_TARGET`
(Jenkins) and `BUILDKITE_PULL_REQUEST_BASE_BRANCH`. A branch is tried as `origin/<branch>`, then
`<branch>`. Outside a pull request (a push to `main`) there is no base, and it checks everything, saying
so — so the same step works on both events.

**The base has to be in the clone.** With the history, git finds the merge base and compares with where
the branch started. In a clone of depth 1 there is none: it compares with the tip of the base, says so,
and that is exact for the merge commit GitHub checks out for a pull request. A clone of one branch does
not have `origin/main` at all; fetch it by name (a bare `git fetch origin main` only sets `FETCH_HEAD`):

<!-- x-release-please-start-version -->

```yaml
on: [push, pull_request]
jobs:
    crowded-folders:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
              with: { fetch-depth: 0 } # the history, for the merge base
            # or, keeping depth 1, only the base:
            # - run: git fetch --depth=1 origin "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"
            #   if: github.event_name == 'pull_request'
            - uses: actions/setup-node@v7
              with: { node-version: 24 }
            - run: npx --yes crowded-folders@1.0.0 --changed --format github
```

<!-- x-release-please-end -->

On GitLab, `CI_MERGE_REQUEST_DIFF_BASE_SHA` is tried first; the clone has `GIT_DEPTH` commits (20 by
default). If it does not reach that commit, raise `GIT_DEPTH` or fetch the target branch the same way.

## Git hooks

The check looks at the whole tree, so it is not tied to the files of a commit: run it on push, or on
commit if the repository is small.

**husky** (`.husky/pre-push`):

```sh
npx crowded-folders
```

**lefthook** (`lefthook.yml`):

```yaml
pre-push:
    commands:
        crowded-folders:
            run: npx crowded-folders
```

**pre-commit** (Python projects and others), with the hook this repository publishes. It runs the
published package at the version of the tag (it needs Node, which pre-commit installs):

<!-- x-release-please-start-version -->

```yaml
repos:
    - repo: https://github.com/bymaksym/CrowdedFolders
      rev: v1.0.0
      hooks:
          - id: crowded-folders # on pre-push; add `stages: [pre-commit]` to run it on every commit
```

<!-- x-release-please-end -->

The hook sets `pass_filenames: false` and `always_run: true` because the check is about folders, not the files of
one commit. To check only the folders a change reshaped, give the base: `crowded-folders --since origin/main`
([above](#only-what-a-pull-request-changed)): each folder is checked counting every file in it, and the
suppressions of other folders are left alone. Folders can also be named (`crowded-folders src/lib`): only
those folders, what is under them, and their suppressions are looked at.

## Monorepos

One run at the root with overrides per package ([configuring.md](configuring.md#monorepos)), or one
run per package, each with its own configuration: `cd packages/web && npx crowded-folders` (the
configuration is looked for from where the command runs, and its folder is the root). With one run at the
root, `"suppressions": "per-project"` keeps a suppressions file in each package
([adopting.md](adopting.md#one-file-per-project)), so each team owns its own.
