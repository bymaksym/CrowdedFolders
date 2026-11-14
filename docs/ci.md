# In CI and in hooks

crowded-folders reads file names only and has no dependencies, so it runs anywhere Node 20.19+ runs,
in half a second on a repository of 14,000 files (the Godot engine, measured on Linux). On Windows,
where starting Node and git costs more, a run takes about 0.4 s on this repository (150 files) and 0.6 s
on one of 2,400 files: one `git ls-files` instead of four calls took about 0.1 s off each (median of 21
and 15 runs, measured alternating with the version before).

On CI, the run fails with exit code 2 when git cannot list the files, instead of reading the
disk: pass `--no-git` for a checkout without `.git`. A run is on CI when `CI` is set (and not `false` or
`0`), or, without `CI`, when one of `TF_BUILD`, `JENKINS_URL`, `BUILDKITE`, `GITHUB_ACTIONS`, `GITLAB_CI`,
`CIRCLECI`, `TEAMCITY_VERSION` or `BITBUCKET_BUILD_NUMBER` is; the messages say which variable it was. `--output` will not write over a file git tracks
unless `--force` is given.

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

`--suppress-all`, `--suppress-rule` and `--prune-suppressions` refuse to write on CI (exit code
`2`): a job that writes its own suppressions passes and leaves nothing in the pull request. Run them on a
machine and commit the file; `--force` is for a job that means it.

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
The files are read from the current folder; no report replaces a file git tracks, or the configuration,
without `--force`; and a report written inside the root is never counted among the files checked.

**Every format** writes control characters in a name as `\xNN` (a folder called `a<ESC>[31m` cannot
recolour a log or fake a line), and never prints the path of the machine it ran on: paths are relative to
the root, so a report can be pasted in a public pull request. The exception is the JSON `folder` and
`files`, which are the names as they are in the repository (JSON escapes them itself).

**Where a format needs a file** (SARIF, annotations, Code Quality, Checkstyle), a finding about a folder is
anchored on a file of that folder, chosen so that it does not change when a file is added (otherwise the
alert is closed and reopened): the file with the lowest hash of folder, rule and key. Findings of the
`config/*` rules go on the configuration file, at the override's line; stale suppressions on the
suppressions file, at theirs. With `--base <ref>` (by default the base of `--since` or `--new-since`, else in a pull request the
base the CI names, read as [`--changed`](#only-what-a-pull-request-changed) reads it), the files the change
adds go first, so GitHub shows the annotation in the
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
  `subfolders`, the `max-files` `limit` in effect, and what that rule counts (`unit`) and compares with it
  (`used`).
- `--format html` writes one self-contained page with a map of the folders, and `--format badge` a
  shields.io endpoint with the share of folders within the max-files limit: [tree.md](tree.md).

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
      comment: false # one comment on the pull request, kept up to date (needs pull-requests: write)
```

<!-- x-release-please-end -->

### One comment on the pull request

With `comment: true`, the action keeps **one** comment on the pull request up to date: what the change
adds, what grew and what improved, against the pull request's base. It finds its own comment by a
marker at the start of the body (`<!-- crowded-folders: pull request comment -->`) and edits it on every
push instead of posting another. It needs the base's commits (`fetch-depth: 0`, or a fetch of the base
branch) and permission to write comments:

<!-- x-release-please-start-version -->

```yaml
on: pull_request
permissions: { contents: read, pull-requests: write }
jobs:
    crowded-folders:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v7
              with: { fetch-depth: 0 }
            - uses: actions/setup-node@v7
              with: { node-version: 24 }
            - uses: bymaksym/CrowdedFolders@v1.0.0
              with:
                  comment: true
                  args: --new-since origin/${{ github.base_ref }} # fail only on what the change adds
```

<!-- x-release-please-end -->

The comment is the Markdown report against a base (`--new-since`, `--since`, `--base`, or the pull
request's own when none is given):

```markdown
Against `origin/main`: **1 new**, **1 grew**, 2 improved, 14 as they were.

### New (1)

| Folder         | Rule      | Problem                                       |
| -------------- | --------- | --------------------------------------------- |
| `src/checkout` | max-files | 21 modules, over the limit of 20: split it... |

### Grew (1)

| Folder    | Rule      | Before | Now | Problem                                       |
| --------- | --------- | -----: | --: | --------------------------------------------- |
| `src/api` | max-files |     22 |  25 | 25 modules, over the limit of 20: split it... |

### Improved (2)

- `src/legacy` max-files: gone
- `src/ui` prefix-groups `button`: 6 → 4
```

followed by what was already there, folded in a `<details>`. It is posted with `gh api` and the job's
`GITHUB_TOKEN` (`token` takes another), so the action installs nothing. The token of a pull request from a
fork cannot write: the step then warns and the check still passes or fails on its own. GitHub takes 65 536
characters in a comment; a longer report is cut, and the job summary has it whole.

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

## Only what a pull request changed

Two flags compare with a base, and both read only file names: git lists the base's names
(`git ls-tree`) without checking it out.

| Flag                            | Checks                                                            | Fails on                                       | Use it when                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--since <ref>`, or `--changed` | only the folders the change reshaped, and only their suppressions | any problem in them, as a normal run would     | you keep a suppressions file and want the pull request to answer for the folders it touched, and only those   |
| `--new-since <ref>`             | the whole repository                                              | problems that are new, or grew, since the base | you adopt it without a suppressions file ([adopting.md](adopting.md#without-a-suppressions-file---new-since)) |

A folder is **reshaped** when a file was added to it or removed from it, or a subfolder of it appeared
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

**Do not pass the changed files as arguments.** `crowded-folders $(git diff --name-only origin/main...HEAD)` looks
right and is not: in a shallow clone `origin/main...HEAD` has no merge base and git fails; the arguments are
folders to check, so a deleted file names a folder that is not there; and a few thousand paths pass the
length of a command line (`Argument list too long` on Linux, about 32 000 characters on Windows).
`--since` and `--changed` read the same difference from git, with none of the three problems.

### What a change to the configuration does

A pull request that raises a limit or adds an override changes what every later run reports, and its
diff shows JSON, not that. `--compare-config <ref>` loads the configuration file as it was at `<ref>`
(`git show <ref>:<file>`), runs both over the same files and says it in one sentence, on standard error,
in the text and Markdown reports and as `configChange` in the JSON:

```text
--compare-config: Since origin/main, the configuration raises max-files max from 20 to 40, adds 1
override and silences 37 problems in 12 folders.
```

Only JSON configurations (`.json`, `.jsonc`, the `"crowded-folders"` key of `package.json`): `git show`
gives the text of a file, and a JavaScript configuration from another commit would have to run, with its
imports, as it was. For one of those, `git diff <ref> -- crowded-folders.config.mjs` is the comparison.
What the file extends (presets, a shared file, plugins) is read as it is today, so the sentence is about
the file the pull request changed.

## How a folder grew

`crowded-folders history <folder>` measures the folder at a few commits along the first parents of
`HEAD` (`git log --first-parent`), each from its file names (`git ls-tree`: no checkout, a second or two
on a large repository), with today's configuration:

```text
12 commits sampled along the first parents, 2026-04-28 (90af1cf) → 2026-10-28 (c9829f2).

src/cli  ▁▁▂▂▃▄▅▆▇█  went from 8 to 31 modules in six months, limit 12
```

Without a folder it lists the ten that grew most. `--samples <n>` measures more or fewer commits (12
by default), and `-f json` prints every sample (`commit`, `date`, `modules`, `files`) for a chart. A
shallow clone has only the commits it fetched.

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

pre-commit installs only its `pre-commit` hook unless told otherwise. A hook on `pre-push` runs once that
one is installed too:

```sh
pre-commit install --hook-type pre-push
```

The hook sets `pass_filenames: false` and `always_run: true` because the check is about folders, not the files of
one commit. To check only the folders a change reshaped, give the base: `crowded-folders --since origin/main`
([above](#only-what-a-pull-request-changed)): each folder is checked counting every file in it, and the
suppressions of other folders are left alone. Folders can also be named (`crowded-folders src/lib`): only
those folders, what is under them, and their suppressions are looked at.

## Build tools

The check reads file names only, so it needs no build: a step before the build, or a task of its own, is
enough. Each recipe pins the version, like the CI ones. **Renovate and Dependabot do not update a version
written inside a command** (`npx crowded-folders@1.0.0` in a `run:`, a Makefile or a `pom.xml`). Either
install crowded-folders as a devDependency, which they do update, and run `npx --no-install crowded-folders`,
or give Renovate a [regex manager](https://docs.renovatebot.com/modules/manager/regex/) for the line.

<!-- x-release-please-start-version -->

**Maven** (`pom.xml`, with [exec-maven-plugin](https://www.mojohaus.org/exec-maven-plugin/), in `validate`):

```xml
<plugin>
    <groupId>org.codehaus.mojo</groupId>
    <artifactId>exec-maven-plugin</artifactId>
    <executions>
        <execution>
            <id>crowded-folders</id>
            <phase>validate</phase>
            <goals><goal>exec</goal></goals>
            <configuration>
                <executable>npx</executable>
                <arguments><argument>--yes</argument><argument>crowded-folders@1.0.0</argument></arguments>
            </configuration>
        </execution>
    </executions>
</plugin>
```

On Windows the executable is `npx.cmd`.

**Gradle** (`build.gradle.kts`), as a task that `check` depends on:

```kotlin
val crowdedFolders by tasks.registering(Exec::class) {
    group = "verification"
    commandLine("npx", "--yes", "crowded-folders@1.0.0")
}
tasks.named("check") { dependsOn(crowdedFolders) }
```

**Nx** (`project.json` of the root project). One target for the repository: the configuration at the root
already knows the packages, and `--group-by project` says which one is the worst.

```json
{
    "targets": {
        "crowded-folders": {
            "command": "npx --yes crowded-folders@1.0.0 --group-by project",
            "cache": false
        }
    }
}
```

**Turborepo** (`turbo.json`, with a script in the root `package.json`, `"crowded-folders": "crowded-folders"`,
and the package as a devDependency). It is a root task, `//#`, because one run reads the whole tree:

```json
{
    "tasks": {
        "//#crowded-folders": { "cache": false }
    }
}
```

Run it with `turbo run //#crowded-folders`. Turn caching off in both: the input is every file name of the
repository, which neither tool hashes by default.

**just** (`justfile`):

```just
folders:
    npx --yes crowded-folders@1.0.0
```

**make** (`Makefile`):

```make
.PHONY: folders
folders:
	npx --yes crowded-folders@1.0.0
```

<!-- x-release-please-end -->

## Monorepos

One run at the root with overrides per package ([configuring.md](configuring.md#monorepos)), or one
run per package, each with its own configuration: `cd packages/web && npx crowded-folders` (the
configuration is looked for from where the command runs, and its folder is the root). With one run at the
root, `"suppressions": "per-project"` keeps a suppressions file in each package
([adopting.md](adopting.md#one-file-per-project)), so each team owns its own.

`--group-by project` and the `project` field of the JSON say which package is the worst; with a CODEOWNERS
file, `--owner @org/team` runs the check for one team.

With one SARIF upload per package, give each its own `category` (`category: crowded-folders-web`): code
scanning keeps one set of results per category, and a second upload with the same one replaces the first.
