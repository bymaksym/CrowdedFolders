# Using it from ESLint

`crowded-folders/eslint` is the analysis as an ESLint plugin. It exists for one reason: almost everything
that lints a JavaScript or TypeScript project already runs ESLint, so a rule inside it reaches the places the
command does not: the editor's squiggle, the ESLint MCP server an AI agent asks, a pre-commit hook that
already runs `eslint`, and oxlint's JS plugins. The command stays the way to check a repository without Node
and the one with every option (`--since`, `--owner`, SARIF); the plugin is the same findings, shown where
people already look.

It is flat config only, ESLint 9 or 10. ESLint is an optional peer dependency: the package installs nothing
for it, and `npx crowded-folders` never loads it.

```js
// eslint.config.js
import crowdedFolders from 'crowded-folders/eslint';

export default [
    // … your configuration …
    crowdedFolders.configs.recommended,
];
```

`recommended` is a config object that registers the plugin and turns `crowded-folders/folder` on as an
`error`. To choose the severity or give options, register the plugin yourself:

```js
import crowdedFolders from 'crowded-folders/eslint';

export default [
    {
        plugins: { 'crowded-folders': crowdedFolders },
        rules: { 'crowded-folders/folder': ['warn', { config: 'crowded-folders.config.json', errorsOnly: true }] },
    },
];
```

## What the rule reports

There is one rule, `crowded-folders/folder`. A folder is not a file, so where a finding is shown needs a
rule: for each linted file, the rule reports the findings of that file's folder, **once per folder**, at
line 1, column 1 of the first linted file in it. The message is the finding's, followed by the rule that
found it and its documentation:

```text
src/cli/render-pr.ts
  1:1  error  5 modules start with "render" (render-json, render-pr, …) [prefix-groups] https://…/prefix-groups.md  crowded-folders/folder
```

- The findings are the ones `npx crowded-folders` reports: the same configuration (found upwards from
  ESLint's working directory, or the file the `config` option names), the same presets, and the suppressions
  file applied. A folder you suppressed is not reported here either.
- Only findings **of that folder** are reported on its files. A finding on `src` shows on a file directly in
  `src/`, not on one in `src/cli/`.
- ESLint's severity for the rule is the severity of every report; a finding's own severity is not carried
  over. With `errorsOnly: true` only the findings the command fails on (`error`) are reported, so a `warn`
  finding stays quiet instead of becoming an error.
- Code that is not a file of the repository (`lintText` without a path, a path outside the root) reports
  nothing.

| Option       | Default | What it does                                                                         |
| ------------ | ------- | ------------------------------------------------------------------------------------ |
| `config`     | found   | A configuration file, relative to ESLint's working directory.                        |
| `errorsOnly` | `false` | Report only the findings of severity `error`, the ones that make the command exit 1. |

## How it works, and what to know

ESLint rules are synchronous and loading a configuration (and its plugins) is not, so the first linted file
starts one short Node process that makes a linter with [`createLinter`](api.md#createlinteroptions),
runs it once over the repository's file list, and hands the findings back. The result is kept for the life of
the process, per working directory and configuration. That costs a few hundred milliseconds once, and nothing
on the following files.

- **The analysis is a snapshot.** A file added after it was made is not counted until the process is
  restarted. A long-lived ESLint server (an editor, the MCP server) therefore shows the repository as it
  was when the first file was linted; restarting it refreshes it. The command is the source of truth in CI.
- **"First linted file" is per process.** In one `eslint .` run each folder reports once. An editor lints
  one file at a time: the file that reported a folder keeps reporting it when it is linted again, and the
  other files of the folder stay quiet.
- **`eslint --cache`** reuses the results of files that did not change, and a folder's finding depends on its
  other files. Do not combine them in CI, or run the command there.
- **Which files get the rule** is ESLint's `files`. The rule says nothing about a file ESLint does not
  lint, so a folder of only Markdown or JSON files that ESLint skips is not reported. Use the command for
  those; it reads every file.
- **A broken configuration** stops ESLint with the message `npx crowded-folders` would print (for example an
  override without `reason`).

## oxlint and the ESLint MCP server

- The [ESLint MCP server](https://eslint.org/docs/latest/use/mcp) lints the files an agent names with the
  project's `eslint.config.js`, so with the plugin in it the agent sees the findings of the folder it just
  wrote into.
- oxlint loads ESLint-compatible plugins through its `jsPlugins` setting. The rule uses only `context.filename`,
  `context.cwd`, `context.options` and `context.report`, and no AST node, which is what a JS plugin has the
  best chance of getting right. It has not been run under oxlint in this repository's CI; report what you
  find.

## Testing it

The plugin is tested with ESLint's own `RuleTester` and with the `ESLint` class over repositories made on
disk (`src/eslint.test.ts`); `tooling/test-package.mjs` imports it from the packed tarball the way a user
does.
