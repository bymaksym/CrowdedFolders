# For AI coding agents

Agents add files without looking at the folder they add them to. This is the kit that makes them look: a
question they can ask before writing (`where`), a hook that asks it for them, a skill that teaches the
output, a task they can be handed (`explain --prompt`) and a plugin that bundles the hook and the skill.
Everything is a warning or a text: nothing here moves a file, blocks a write or changes a limit.

| Piece                                           | What it is                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| [`where`](#where-would-this-file-make-it-worse) | Would a file at this path create, worsen or leave a problem as it is?    |
| [`hook claude`](#the-claude-code-hook)          | A `PreToolUse` hook for `Write`, `Edit` and `MultiEdit` that warns.      |
| [`init --agents`](#init---agents)               | Adds the hook to `.claude/settings.json` and a block to `AGENTS.md`.     |
| [`explain --prompt`](#explain-folder---prompt)  | The reorganisation of a folder, as a task to paste to an agent.          |
| [The skill](#the-skill)                         | `skills/crowded-folders/SKILL.md`: when to run the tool, how to read it. |
| [The plugin](#the-claude-code-plugin)           | The hook and the skill, as a Claude Code plugin.                         |

## `where`: would this file make it worse?

```console
$ crowded-folders where core/enums/foo-bar.enum.ts core/layout/navbar-mobile.component.ts
core/enums/foo-bar.enum.ts
  WORSE max-files 14→15 (limit 10)
  max-files in core/enums/: 15 files, over the limit of 10: split it into folders by what the files are about.

core/layout/navbar-mobile.component.ts
  OK, and core/layout/navbar/ exists
```

The files need not exist; relative paths start where you typed the command, absolute ones are fine, and a
path outside the repository is an error. Each path is asked on its own, against the files that exist now.

| First line                   | Means                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `OK`                         | No rule is hurt. `OK, and <folder>/ exists` when a subfolder is named like the file's start. |
| `CREATES <rule> <n> (limit)` | The folder has no such problem now; with the file it has (`max-files 11 (limit 10)`).        |
| `WORSE <rule> <a>→<b>`       | The folder has it already and the file makes it bigger (`max-files 14→15`).                  |
| `BETTER`                     | The file fixes a problem: a folder with one file gets its second.                            |
| `EXISTS`, `UNCHECKED`        | The file is there already, or the configuration or `.gitignore` leaves the place out.        |

Below the verdict: the rule's message; the folders that fit (an existing subfolder whose name matches the
words the file name starts with, singular or plural, longest first); where the rule that complains would
put the file (`Move: git mv …`); and, when the file is not yet a junk drawer's worth, the group it joins (`It
joins the group "navbar-*" with 3 modules; prefix-groups asks for a folder at 4`).

Exit code `0` always, because it answers a question; `--fail-on worse` makes it `1` when a file would be
`CREATES` or `WORSE`, for a script. `-f json` prints `{ "version": 1, "results": [...] }`, one result per
path with `effect`, `changes` (`new`, `worse`, `same`, `fixed`, with `before`, `after`, `limit` and
`message`) and `candidates`.

How it knows: the folder of the file (and, when the file makes a new folder, the nearest one above it) is
checked twice by the engine, without and with the file, and the two lists of problems are compared. It is
the same engine and the same configuration as `crowded-folders`, so it cannot say `OK` about a file that
`check` will report once it is there. It is available from code too, with the files already loaded:

```js
import { createLinter } from 'crowded-folders';

const linter = await createLinter();
const [answer] = linter.where(['core/enums/foo-bar.enum.ts']);
answer.effect; // 'worsens'
```

`whereWouldGo({ files, config, rules, path })` in `crowded-folders/engine` is the same without Node.

## The Claude Code hook

```sh
crowded-folders hook claude
```

Reads the JSON Claude Code sends a `PreToolUse` hook on standard input and, for a **new** file written with
`Write` (or `Edit`/`MultiEdit`) that `where` calls `CREATES` or `WORSE`, prints:

```json
{
    "systemMessage": "crowded-folders: core/enums/foo-bar.enum.ts: WORSE max-files 14→15 (limit 10)",
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "additionalContext": "crowded-folders: core/enums/foo-bar.enum.ts: WORSE max-files 14→15 (limit 10)\n  …\nThis is a warning, nothing was blocked. …"
    }
}
```

- `additionalContext` is what the agent reads (Claude Code adds it to its context next to the tool result);
  `systemMessage` is a line for you.
- It never carries a `permissionDecision`, so the write goes on through the normal permission flow, and it
  always exits `0`: a hook that blocks, or that fails loudly, is the first one to be turned off.
- When the file is fine but an existing folder fits its name, `additionalContext` says so, alone.
- Whatever else happens (an `Edit` of a file that exists, another tool, text that is not JSON, no git, a
  broken configuration) it prints nothing on standard output; the reason goes to standard error.

Checked against the Claude Code documentation (<https://code.claude.com/docs/en/hooks>): the input fields
`hook_event_name`, `tool_name`, `tool_input.file_path` and `cwd`; the output `hookSpecificOutput` with
`additionalContext`, and `systemMessage`; exit `0`; the `timeout` in seconds. The current page names `Write`
and `Edit`; `MultiEdit` is in the matcher because older versions have it, and it only matters for files that
are not there, which an edit tool does not create. The page does not say what an omitted `permissionDecision`
means for `PreToolUse`; the hook relies on it leaving the normal flow, and `allow` is not used because it
would skip the permission prompt.

**Cursor** has a `preToolUse` hook (<https://cursor.com/docs/hooks>), but it answers `allow` or `deny`:
there is no documented way to tell the agent something without deciding, so there is no `hook cursor`.
Use `AGENTS.md` (Cursor reads it) and the `where` command.

### Latency

Measured on this repository (223 files), Windows 11, Node 24:

| What                                           | Time                                                            |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `node -e 0`, the floor                         | 76 ms                                                           |
| `where` or `hook`, once the code is loaded     | 55 to 80 ms: `git ls-files` is about 45 of them, the analysis 5 |
| `node bin/crowded-folders.js hook claude`, all | about 450 ms: 250 to 300 ms of it is loading the package        |
| `npx --no-install crowded-folders hook claude` | about 1.5 s on Windows, where `npx` alone costs a second        |

On Linux and macOS `npx` costs a fraction of that. If the second matters, replace the command in
`.claude/settings.json` by `node node_modules/crowded-folders/bin/crowded-folders.js hook claude`, which
works when Claude Code starts at the project root.

## `init --agents`

```console
$ crowded-folders init --agents --dry-run
--- /dev/null
+++ b/.claude/settings.json
@@ -0,0 +1,15 @@
+{
+  "hooks": {
+    "PreToolUse": [
…
Dry run: nothing was written.
```

- `.claude/settings.json`: the `PreToolUse` hook with the matcher `Write|Edit|MultiEdit`, command
  `npx --no-install crowded-folders hook claude` and a timeout of 10 seconds. Everything else in the file,
  every other hook, and its indentation stay; if a hook for `crowded-folders hook claude` is there already,
  written by hand or by an earlier run, nothing changes. A file with comments or that is not JSON is an
  error that names the problem and writes nothing.
- `AGENTS.md`: a short block between `<!-- crowded-folders:start -->` and `<!-- crowded-folders:end -->`.
  Created when there is no file; appended after a blank line when there are no markers; replaced between
  the markers when there are, so running it after an upgrade updates the text and touches nothing else.
- `--dry-run` prints each change as a diff and writes nothing. Files are written whole or not at all.
- It writes no configuration: `crowded-folders init` does that. The hook uses the project's copy of the
  package, so add it (`npm install --save-dev crowded-folders`); `init --agents` says when it is not there.

## `explain <folder> --prompt`

Prints, instead of the explanation, the reorganisation of the folder as a task for an agent: what the tool
reports; the modules; the groups it asks to move and the groups that come close; the proposed moves
(`mkdir`, `git mv`; **nothing is applied**); the files that name the paths to move; and the steps: move with
`git mv`, update every import and path, run the type check and the tests, run the tool again, and do not
raise a limit or add a suppression to get there. A folder with no problem says so and asks for nothing.

```sh
crowded-folders explain src/core/enums --prompt | claude
```

## The skill

[`skills/crowded-folders/SKILL.md`](../skills/crowded-folders/SKILL.md) ships in the package. Claude Code
reads a skill folder from `.claude/skills/` (project) or `~/.claude/skills/` (yours): copy
`node_modules/crowded-folders/skills/crowded-folders` there, or take it through the plugin. It tells the agent
when to run the tool (before adding a file to a crowded folder, after moving files, on a crowded folder),
how to read each verdict of `where`, and what not to do (raise a limit, add an override, loop `mv`).

## The Claude Code plugin

The package root is a plugin, in the layout Claude Code requires:

```text
.claude-plugin/plugin.json   the manifest (a name; no version of its own: it would drift from package.json)
hooks/hooks.json             the same hook, through ${CLAUDE_PLUGIN_ROOT} and node
skills/crowded-folders/      the skill
```

Try it from an installed package, without a marketplace:

```sh
claude --plugin-dir node_modules/crowded-folders
```

Use the plugin or `init --agents`, not both: each registers the hook, and the agent would hear it twice.
Nothing is published to a marketplace.
