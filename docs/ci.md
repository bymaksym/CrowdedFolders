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

## Output formats

| `--format`   | For                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`       | People (default). Colours in a terminal; `NO_COLOR`, `FORCE_COLOR`, `--color`, `--no-color`.                                                                                                                              |
| `github`     | GitHub Actions annotations, on a file of each folder.                                                                                                                                                                     |
| `sarif`      | GitHub code scanning and other SARIF viewers.                                                                                                                                                                             |
| `markdown`   | A pull-request comment or `$GITHUB_STEP_SUMMARY`.                                                                                                                                                                         |
| `json`       | Scripts. Described by [`report.schema.json`](#the-json-report).                                                                                                                                                           |
| `gitlab`     | GitLab Code Quality (`artifacts:reports:codequality`).                                                                                                                                                                    |
| `checkstyle` | Jenkins warnings-ng, reviewdog, Danger, SonarQube.                                                                                                                                                                        |
| `azure`      | Azure Pipelines (`##vso[task.logissue]`).                                                                                                                                                                                 |
| `auto`       | `github` under GitHub Actions (`GITHUB_ACTIONS`), `azure` under Azure Pipelines (`TF_BUILD`), else `text`. GitLab's log has no annotations, so it gets `text`: ask for `gitlab` as a file, as in [GitLab CI](#gitlab-ci). |

`--output <file>` writes the report to a file instead of standard output. To write several reports in
**one run**, repeat `--format` and name a file for each (at most one goes to standard output):

```sh
crowded-folders -f github -f sarif=crowded-folders.sarif -f markdown="$GITHUB_STEP_SUMMARY"
```

A file named by `$GITHUB_STEP_SUMMARY` is appended to, not replaced, because earlier steps wrote to it.

**Every format** writes control characters in a name as `\xNN` (a folder called `a<ESC>[31m` cannot
recolour a log or fake a line), and never prints the path of the machine it ran on: paths are relative to
the root, so a report can be pasted in a public pull request. The exception is the JSON `folder` and
`files`, which are the names as they are in the repository (JSON escapes them itself).

**Where a format needs a file** (SARIF, annotations, Code Quality, Checkstyle), a finding about a folder is
anchored on a file of that folder, chosen so that it does not change when a file is added (otherwise the
alert is closed and reopened): the file with the lowest hash of folder, rule and key. Findings of the
`config/*` rules go on the configuration file, at the override's line; stale suppressions on the
suppressions file, at theirs. With `--base <ref>` (in a pull request, `origin/$GITHUB_BASE_REF` is used
when `GITHUB_BASE_REF` is set), the files the change adds go first, so GitHub shows the annotation in the
diff. SARIF carries a fingerprint of folder, rule and key, so the same problem is the same alert.

A run that cannot be completed (exit code 2) still writes the SARIF, with
`invocations[0].executionSuccessful` false, and in `github` and `azure` an error on the configuration file,
so `upload-sarif` does not fail later on a file that does not exist and hide the cause.

**GitHub shows 10 annotations of each kind per step** and drops the rest without a word, so `github`
writes the 9 worst of each kind (the furthest over the limit first) and a tenth that says how many more
there are (`--max-findings` changes the 9). SARIF and Markdown have the rest.

**Markdown** lists the 200 worst problems (`--max-findings`), with a summary per project (or top-level
folder), and stays under the 1 MiB GitHub keeps of a job summary whatever the cap. Names are in code and
the rest is escaped: a file called `report-@octocat` notifies nobody and `<img>` is not drawn.

**Text** links each rule to its documentation: an OSC 8 hyperlink on a terminal, a footer with the URLs
otherwise. `--group-by project` (or `owner`) groups the findings by the nearest folder with a
`package.json`, `project.json`, `go.mod`, `Cargo.toml`, `pom.xml` or `BUILD.bazel` (or by CODEOWNERS owner),
the worst first, with a top 10.

### The JSON report

`report.schema.json` is published with the package (`crowded-folders/report.schema.json`) and the tests
validate the JSON output against it. Fields are only ever added in a minor version; renaming or removing
one raises `formatVersion` (now `1`).

- `run`: the `presets` in effect, whether they were detected (`presetsDetected`), the `configFile`, the
  `fileSource` (`git`, `disk` or `stdin`) and the `root`, relative to where the command ran. Adding a
  dependency can change the detected presets, and this is where the report says so. The SARIF has the same
  in its run `properties`.
- `measured` is the number that broke the rule and `limit` the limit **as the configuration writes it**:
  `max` for `max-files` and `max-folders`, `min` for `prefix-groups`. `comparison` says how they compare:
  `">"` fails when `measured` is over the limit, `">="` when it reaches it (`prefix-groups` with `min: 4` is
  `limit: 4, comparison: ">="`). For `config/unused-override`, `measured` is `1` (one override, not a count
  of anything) and `limit` is `0`.
- `project` is the finding's project (`null` if none) and `owners` its CODEOWNERS owners: the last matching
  pattern in `.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`. `--owner @org/team` keeps only that
  owner's problems, and the exit code follows.
- `--no-files` leaves `files` and `moves` out of each finding (`fileCount` stays): on a large repository
  they are most of the report. `--stats` adds `folders`: every folder with its `modules`, `files`,
  `subfolders` and the `max-files` `limit` in effect.

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

With a summary on the job page and SARIF for code scanning, in **one run**:

<!-- x-release-please-start-version -->

```yaml
permissions: { contents: read, security-events: write }
steps:
    - uses: actions/checkout@v7
    - uses: actions/setup-node@v7
      with: { node-version: 24 }
    - id: check
      run: npx --yes crowded-folders@1.0.0 -f github -f sarif=crowded-folders.sarif -f markdown="$GITHUB_STEP_SUMMARY"
      continue-on-error: true # the upload below must run even when this fails
    - uses: github/codeql-action/upload-sarif@v4
      with: { sarif_file: crowded-folders.sarif, category: crowded-folders }
    - run: exit 1
      if: steps.check.outcome == 'failure'
```

<!-- x-release-please-end -->

Or the action in this repository, which does the same in one run and runs the crowded-folders version it
was released with, so pinning the action pins the tool (`version` runs another):

<!-- x-release-please-start-version -->

```yaml
- uses: bymaksym/CrowdedFolders@v1.0.0
  with:
      args: --max-warnings 0 # anything the command takes
      summary: true # add the Markdown report to the job summary
      sarif: true # upload to code scanning (needs security-events: write)
      category: crowded-folders # the code scanning category
      fail-on: error # error, warning (also any warning) or none (only a wrong configuration fails)
```

<!-- x-release-please-end -->

Outputs: `exit-code`, `errors`, `warnings` and `sarif-file`. The action is composite, not `node24`: a
JavaScript action runs a bundle committed to the tag, and this repository has no bundler or dependencies to
produce one that is guaranteed to match each release. A composite action runs the published package at the
exact version of the tag, which release-please already keeps in step.

## GitLab CI

For the merge-request widget, GitLab reads a Code Quality report. Write it next to the log:

<!-- x-release-please-start-version -->

```yaml
crowded-folders:
    image: node:24
    script:
        - npx --yes crowded-folders@1.0.0 -f text -f gitlab=gl-code-quality-report.json
    artifacts:
        when: always
        reports:
            codequality: gl-code-quality-report.json
```

<!-- x-release-please-end -->

The fingerprints are stable (folder, rule and key), so the widget shows what a branch adds and not what
moved.

## Azure Pipelines

<!-- x-release-please-start-version -->

```yaml
- script: npx --yes crowded-folders@1.0.0 --format azure
  displayName: crowded-folders
```

<!-- x-release-please-end -->

Each problem becomes a `task.logissue` on a file of the folder. `--format auto` picks this when `TF_BUILD`
is set.

## Other CI (Jenkins, CircleCI, Buildkite…)

Any step that can run Node: `npx --yes crowded-folders@1.0.0`. The exit code does the rest. Jenkins
warnings-ng and reviewdog read `--format checkstyle` (or SARIF). <!-- x-release-please-version -->

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

The published hook uses `npx --prefer-offline`: it needs the registry the first time, and its cache after
that. It cannot be built from the repository's own sources instead: pre-commit packs a git checkout without
its devDependencies, so there is no compiler to run in `prepare`. **Offline, or behind a mirror that does
not serve the package**, install crowded-folders as a devDependency (the lockfile pins it and nothing is
fetched) and run it from a local hook:

```yaml
repos:
    - repo: local
      hooks:
          - id: crowded-folders
            name: crowded-folders
            entry: npx --no-install crowded-folders
            language: system
            pass_filenames: false
            always_run: true
            stages: [pre-push]
```

The hook sets `pass_filenames: false` and `always_run: true` because the check is about folders, not the files of
one commit. To check only the folders a change touches, pass them:
`crowded-folders $(git diff --name-only origin/main...HEAD)` (their folders are checked, counting every
file in them).

## Monorepos

One run at the root with overrides per package ([configuring.md](configuring.md#monorepos)), or one
run per package, each with its own configuration: `cd packages/web && npx crowded-folders` (the
configuration is looked for from where the command runs, and its folder is the root).

`--group-by project` and the `project` field of the JSON say which package is the worst; with a CODEOWNERS
file, `--owner @org/team` runs the check for one team.
