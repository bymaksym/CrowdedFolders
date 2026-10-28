# Using it from code

```js
import { lint } from 'crowded-folders';

const result = await lint({ cwd: '/path/to/repo', suppressions: true });
for (const finding of result.kept) {
    console.log(finding.folder, finding.rule, finding.message);
}
process.exitCode = result.exitCode; // what `npx crowded-folders` would exit with
```

The package is ESM with TypeScript types, in three entry points; nothing else under `dist/` can be
imported (`exports` closes it), so nothing else is part of the API.

| Entry point               | What it is                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `crowded-folders`         | Everything: `lint`, `createLinter`, and all of `crowded-folders/engine`.                                       |
| `crowded-folders/engine`  | The analysis without Node: it reads no file and touches no `process`, so it bundles for a browser or a worker. |
| `crowded-folders/testing` | `RuleTester`, for the rules of a plugin ([plugins.md](plugins.md#testing-it)).                                 |

The package declares `"sideEffects": false`: importing it runs nothing, so a bundler keeps only what is used.

## `lint(options?)`

Checks a repository the way the command does and returns the findings, without printing or writing
anything.

| Option         | Default                                                                    |                                                                                                                        |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cwd`          | `process.cwd()`                                                            | Where relative paths start, and where to look for the configuration without `root`.                                    |
| `config`       | found from `root`, else from `cwd`, upwards                                | A configuration object, or the path of a configuration file. With none, the presets are detected, as the command does. |
| `root`         | the configuration's folder, else the top of the git repository, else `cwd` | The folder checked.                                                                                                    |
| `files`        | asked to git, or read from the disk                                        | Paths relative to the root. Pass them to check a list without touching the disk.                                       |
| `suppressions` | `false`                                                                    | `true` applies the suppressions file the configuration names (by default next to it), or a path from `cwd` names one.  |
| `rules`        | `{}`                                                                       | Extra rules by full name, as a plugin would add them (handy for testing a rule).                                       |

`files` are read the way the command reads them: `./a.ts` and `a\b.ts` are `a.ts` and `a/b.ts`, an
absolute path under the root is made relative to it, and a path outside the root (`../x`, `/src/a.ts`)
throws a `FileListError` listing each one. `runEngine` reads its `files` the same way. Inside a git
repository whose git fails, `lint()` throws a `GitError` instead of reading the disk.

It returns:

| Field                      |                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `findings`                 | Every finding, suppressed or not.                                                                             |
| `kept`                     | What the command reports: the findings no suppression covers (all of them without `suppressions`).            |
| `suppressed`               | The findings a suppression covers.                                                                            |
| `stale`                    | The suppressions the command fails on until they are pruned (`{ folder, id, status, … }`).                    |
| `exitCode`                 | `1` for an error in `kept` or a stale suppression, else `0`: the command's exit code, from the same function. |
| `configFile`               | The configuration file read, absolute; `undefined` for a configuration object or none.                        |
| `presets`                  | The presets in effect, in the order applied.                                                                  |
| `detected`                 | Without a configuration: the presets found and what gave each away (`{ preset, evidence }`).                  |
| `root`                     | The folder the paths of the findings start from.                                                              |
| `folderCount`, `fileCount` | What was checked. The suppressions file is not counted, as the command does not count it.                     |

The suppressions file and the presets are read by the same code as the command's, so `lint()` and
`npx crowded-folders` cannot disagree about a repository. What the command adds on top — `--since`,
`--new-since`, `--owner`, `--max-warnings` — is not part of `lint()`.

A `Finding` is:

```ts
interface Finding {
    rule: string; // 'max-files', 'acme/no-generic-names', 'config/unused-override'
    severity: 'error' | 'warn';
    folder: string; // relative to the root; the root is '.'
    message: string;
    key: string | undefined; // the prefix, for prefix-groups
    measured: number;
    limit: number | undefined;
    files: readonly string[]; // relative to the root
    moves: readonly { from: string; to: string }[];
    url: string | undefined; // the rule's documentation
}
```

Errors it throws:

| Error                   | When                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfigError`           | The configuration is wrong; `origin` (the file) and `problems` (`{ at, message }[]`). A plugin made for another major version of crowded-folders is one.                                    |
| `RuleError`             | A rule broke — threw, returned a promise, or reported something that is not a problem. `rule`, `folder`, `plugin`: "acme/boom failed in src: … (report it to crowded-folders-plugin-acme)". |
| `FileListError`         | A path of `files` is not a file of the root.                                                                                                                                                |
| `GitError`              | Git failed inside a repository.                                                                                                                                                             |
| `SuppressionsFileError` | The suppressions file is not JSON, or not a suppressions file.                                                                                                                              |

## `createLinter(options?)`

For an editor, an agent's hook or a watch mode: the configuration and its plugins are loaded once, and
each run only lists (or takes) the files and reads the suppressions.

```js
import { createLinter } from 'crowded-folders';

const linter = await createLinter({ cwd: workspace });
// On each save:
const { kept } = linter.lint({ only: ['src/features/cart'], suppressions: true });
```

It takes the options of `lint()` but `suppressions` (`files` there only says what presets are detected
from, when there is no configuration). `linter.lint({ files?, suppressions?, only? })` is synchronous
and returns what `lint()` returns; `only` checks the folders equal to or under those paths. The linter
also has `root`, `configFile`, `presets`, `detected`, `config`, `rules`, `plugins` and `presetsByName`.

What was read when it was made stays as it was: the configuration, its plugins and the detected
presets. Make another linter when the configuration changes. (A configuration written in JavaScript is
cached by Node's module loader once imported; a JSON one is read again.)

## For configurations and plugins

| Export                                                             |                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `defineConfig(config)`                                             | Types a configuration written in JavaScript.                   |
| `definePlugin(plugin)`, `definePreset(preset)`, `defineRule(rule)` | Type a plugin and its parts ([plugins.md](plugins.md)).        |
| `BUILT_IN_PRESETS`, `BUILT_IN_RULES`                               | Everything that comes with the package, by name.               |
| `configSchema(rules, presets)`                                     | The JSON Schema of a configuration (what `schema.json` holds). |

## Without Node: `crowded-folders/engine`

For tools that bring their own file list — an editor extension in a browser, a bot in a worker:

```js
import { runEngine, resolveConfig } from 'crowded-folders/engine';

const result = runEngine({ files, ...resolveConfig({ extends: ['react'] }) });
```

| Export                                                  |                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveConfig(config, { plugins?, rules?, presets? })` | Applies a configuration and the presets it extends, and checks it, as loading a file does — without reading anything. Returns `{ config, rules, presets }`, ready to spread into `runEngine`. `extends` names presets only; plugins are passed as objects. |
| `runEngine({ files, config, rules, only? })`            | Runs the rules over a list of paths with a resolved configuration.                                                                                                                                                                                         |
| `detectPresets(files, { dependencies?, presets? })`     | Which presets fit, from the paths and the dependency names: what a run without a configuration uses.                                                                                                                                                       |
| `explainFolder(input, path)`                            | What `crowded-folders explain` shows, as data.                                                                                                                                                                                                             |
| `mergeLayer(base, config, origin, own)`                 | Lays a configuration over another (`extends` is the caller's job; `resolveConfig` does it).                                                                                                                                                                |
| `splitWords`, `stemOf`, `modulesOf`, `groupKeyOf`       | How names are read ([how-it-works.md](how-it-works.md)).                                                                                                                                                                                                   |
| `ConfigError`, `RuleError`, `FileListError`             | As above.                                                                                                                                                                                                                                                  |

A configuration without `extends` gets no preset in `resolveConfig`: `{ rules: { "max-files": "error" } }`
is that rule and nothing else. (`lint()` without any configuration detects the presets instead.)

## Versioning

The API follows semantic versioning from 1.0.0: what this page lists changes incompatibly only in a
major version. So does what the default configuration finds ([decisions.md](decisions.md#what-a-version-promises)):
a limit that goes down — a run that passed and now fails — is a major change.

How names are read is part of that promise, and it reaches the suppressions file: a suppression
remembers the folder, the rule and the group's key, so a change in how a name is split or grouped
changes keys. A release that does it says so; the suppressions whose key changed become stale and
`--prune-suppressions` drops them, and when it makes a new group appear the release is major.
