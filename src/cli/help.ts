/**
 * The help is the published interface: an option that is not here does not exist for anyone who
 * has not read the source. A test checks that every option the parser accepts is listed, and that no
 * line passes 80 columns (a terminal, a man page and a mail all fit it).
 */
export const HELP = `crowded-folders - finds the folders that have become a drawer: too many
files in one place, or several modules sharing a prefix that are a folder
nobody made (render-json, render-text, render-sarif -> render/).

Usage
  crowded-folders [paths...]              check the repository, or these folders
  crowded-folders init                    write a configuration file
  crowded-folders explain <folder>        show how one folder is read, and why
  crowded-folders where <new-path>...     would a new file make a folder worse?
  crowded-folders hook claude             Claude Code hook: warns on new files
  crowded-folders presets [name]          list the presets and their sources
  crowded-folders rules [name]            list the rules and their options
  crowded-folders print-config [folder]   print the configuration in effect
  crowded-folders overrides               list every override and what it covers
  crowded-folders history [folder]        how folders grew along the git history
  crowded-folders <command> --help        one command's options, and an example

Where it looks (paths given to options start from the current folder)
  -c, --config <file>      the configuration (default: found from --root, else
                           from here, upwards to the top of the git repository)
      --root <dir>         the folder to check (default: the configuration's
                           folder, else the top of the git repository, else
                           here). Inside the configuration's folder, its
                           patterns still start where it is
  -p, --preset <name>      use a preset; repeatable. Without a configuration
                           file the presets are detected from the repository
                           (init writes them)
      --stdin              read the file list from standard input, one path per
                           line, from the root or from the current folder as git
                           prints them (git ls-tree -r --name-only HEAD |
                           crowded-folders --stdin)
      --no-git             list files from the disk instead of asking git
                           (.gitignore files are read; .gitattributes is not)
      --require-git        fail instead of reading the disk when git cannot list
                           the files (default when CI is set; inside a
                           repository a failing git always fails)
      --tracked-only       count only the files git tracks, not the ones it
                           would add: a file a previous CI step left behind is
                           not the repository's (default when CI is set)
      --no-tracked-only    count the untracked files too, on CI as well

What it prints
  -f, --format <format>    text (default), json, sarif, github (annotations),
                           markdown, gitlab (Code Quality), checkstyle, azure
                           (Azure Pipelines), auto (github, azure or text, by
                           the CI it runs in). Repeat it to write several
                           reports in one run, each to its own file: -f github
                           -f sarif=out.sarif -f markdown=$GITHUB_STEP_SUMMARY
  -o, --output <file>      write the report to a file instead of standard output
                           (with one -f). No report replaces a file git tracks,
                           or the configuration, without --force
      --max-findings <n>   markdown: list n problems (default 200); github: n
                           annotations per kind (default 9: GitHub shows 10)
      --no-files           json: leave the files and moves out of each finding
      --stats              json: also list every folder with its numbers
      --group-by <what>    text: group by folder (default), project or owner
      --owner <owner>      only the problems of this CODEOWNERS owner
                           (@org/team); repeatable
      --base <ref>         annotations: prefer the files this change adds
                           against <ref> (default: the --since or --new-since
                           ref, else the pull request's base, as --changed)
  -q, --quiet              report errors only (says how many warnings it hid)
      --moves              print under each problem the mkdir and git mv it
                           suggests, and the files that name those paths
                           (nothing is ever moved)
      --moves=<sh|pwsh|json>
                           print only the moves, instead of the report:
                           commands for sh or PowerShell, to review and run
                           from the root, or JSON
      --color, --no-color  force colours on or off (default: on in a terminal;
                           NO_COLOR and FORCE_COLOR are honoured)

When it fails
      --max-warnings <n>   fail when there are more than n warnings; -1 or
                           nothing: warnings never fail

Adopting it in a repository that already has problems
      --suppress-all       record every current error in the suppressions file
                           and pass
      --suppress-rule <rule>
                           the same, for one rule; repeatable
      --prune-suppressions remove suppressions nothing needs and lower the ones
                           that went down
      --pass-on-unpruned-suppressions
                           do not fail on suppressions nothing needs
      --suppressions-location <file>
                           the suppressions file (default: crowded-folders-
                           suppressions.json at the root, or "suppressions" in
                           the configuration; "per-project" keeps one in each
                           package)
      --new-since <ref>    fail only on problems that are new or grew since
                           <ref> (git): adopting it without a suppressions file
      --compare-config <ref>
                           also say what the configuration changed since <ref>
                           (git show <ref>:<file>; JSON configurations only):
                           the limits it raised, the problems it silences

Only what a change touched
      --since <ref>        check only the folders the change since <ref>
                           reshaped: a file added, removed or moved, in its old
                           and new folder. Suppressions of other folders are
                           left alone
      --changed            --since the base of the pull request, read from the
                           CI (GITHUB_BASE_REF,
                           CI_MERGE_REQUEST_TARGET_BRANCH_NAME...); outside a
                           pull request, everything is checked

Configuration and monorepos
      --project <dir>      check only <dir>, with the root, configuration and
                           suppressions of its repository (for the per-package
                           tasks of Nx or Turbo)
      --no-detect          without a configuration, use only the presets given
                           with --preset (by default --preset adds to what is
                           detected)
      --no-code            read only JSON configurations: no JavaScript
                           configuration, package or plugin runs (for checking a
                           repository you do not trust)

For AI agents
      --fail-on worse      where: exit 1 when a file would create or worsen a
                           problem (default: always 0, it only says)
      --prompt             explain: print the reorganisation task for an agent
                           (folder, groups, moves, files to update, tests)
      --agents             init: add the Claude Code hook to .claude/ and a
                           block to AGENTS.md, not a configuration
      --dry-run            init --agents: print the diff, change nothing

Other
      --force              init: overwrite an existing configuration; a report:
                           write over a file git tracks, or over the
                           configuration; with CI set, let --suppress-all and
                           --prune-suppressions write the suppressions file
      --samples <n>        history: how many commits to measure (default 12)
  -h, --help               this help
  -v, --version            the version

Exit codes
  0  no errors (and no more warnings than --max-warnings)
  1  errors, too many warnings, or suppressions nothing needs
  2  the configuration or the command line is wrong, or something broke

Documentation: https://github.com/bymaksym/CrowdedFolders#readme
`;

/** The help of one command: what it does, its main options and one line to copy. */
export const COMMAND_HELP = {
    check: `crowded-folders [paths...] [options]

Checks the repository, or only the folders given, and prints what has become
a drawer. Exit 0 when clean, 1 for errors.
  -f, --format <format>   text, json, sarif, github, markdown, gitlab...
  -q, --quiet             errors only
      --max-warnings <n>  fail past n warnings (-1: never)
      --suppress-all      adopt it in a repository that already has problems
Example: crowded-folders src --format json --max-warnings 0
All the options: crowded-folders --help`,
    init: `crowded-folders init [options]

Writes a configuration with the presets that fit the repository, and says how
many problems it has today.
  -c, --config <file>  write it there (default: crowded-folders.config.json at
                       the root, or in .config/ when the repository has one)
  -p, --preset <name>  use these presets instead of detecting them
      --force          replace the existing configuration
      --agents         instead: the Claude Code hook and a block for AGENTS.md
      --dry-run        with --agents: print the diff, change nothing
Example: crowded-folders init --preset react --preset strict`,
    explain: `crowded-folders explain <folder> [options]

Shows how one folder is read: the overrides that apply, how each file name was
split into words, which modules and groups came out, the rules in effect with
where each value comes from, and why the folder is or is not reported. A folder
the configuration leaves out says what excluded it (exit 0).
      --prompt         print the reorganisation task for an AI agent instead
  -c, --config <file>  --root <dir>  -p, --preset <name>  --stdin  --no-git
Example: crowded-folders explain src/components --prompt`,
    where: `crowded-folders where <new-path>... [options]

Says whether a file added at each path would create, worsen or leave as it is a
problem in its folder ("WORSE max-files 14->15"), and which existing folder
fits its name. The file need not exist. Exit 0 unless --fail-on worse.
  -f, --format text|json   --fail-on worse: exit 1 for CREATES or WORSE
  -c, --config <file>  --root <dir>  -p, --preset <name>  --no-git
Example: crowded-folders where src/core/enums/foo-bar.enum.ts`,
    hook: `crowded-folders hook claude

A Claude Code PreToolUse hook for Write, Edit and MultiEdit: reads the hook
JSON from standard input and, when the file is new and would make its folder
worse, answers with a warning for the agent and for you. It never blocks (exit
0); errors are silent. Add it with crowded-folders init --agents.
  -c, --config <file>  --root <dir>  --no-code
Example: crowded-folders init --agents --dry-run`,
    presets: `crowded-folders presets [name]

Lists the presets with what each one does and the guide its numbers come
from: the built-in ones, and those of the plugins the configuration loads, as
"namespace/preset". With a name (or part of one), only the presets that match.
Use them in "extends"; later ones win.
  -c, --config <file>  --root <dir>
Example: crowded-folders presets react
All of them: crowded-folders presets`,
    rules: `crowded-folders rules [name]

Lists the rules with their options and defaults: the built-in ones, and those
of the plugins the configuration loads. With a name (or part of one), only the
rules that match. Each rule's page says when it fires and how to fix it.
  -c, --config <file>  --root <dir>
Example: crowded-folders rules max-files
All of them: crowded-folders rules`,
    'print-config': `crowded-folders print-config [folder] [options]

Prints the configuration in effect after every preset and override, as JSON.
With a folder: the rules, naming and overrides that apply there, each value
with where it comes from.
  -c, --config <file>  --root <dir>  -p, --preset <name>  --stdin  --no-git
Example: crowded-folders print-config src/components`,
    overrides: `crowded-folders overrides [options]

Lists every override in effect: where it comes from, the folders it covers and
what it changes there. An override that turns a rule off or down over more than
a quarter of the folders is pointed out: it is the rule of the repository, not
an exception. It reports and does not fail (exit 0).
  -c, --config <file>  --root <dir>  --project <dir>  -f, --format text|json
Example: crowded-folders overrides`,
    history: `crowded-folders history [folder] [options]

How a folder grew: its modules at a few commits along the first parents of
HEAD, as a line of bars and "went from 8 to 31 modules in six months". Without
a folder, the ten that grew most. Names only (git ls-tree), no checkout.
  --samples <n>  commits to measure (default 12)  -f, --format text|json
Example: crowded-folders history src/cli`,
} as const;
