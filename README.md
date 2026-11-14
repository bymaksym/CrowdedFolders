<p align="center">
  <img src="https://raw.githubusercontent.com/bymaksym/CrowdedFolders/main/.github/banner.png?v=1" alt="crowded-folders — folders that became a junk drawer" width="100%">
</p>

> Finds the folders of a repository that have become a junk drawer: too many files in one place, or
> several modules sharing a prefix that are a folder nobody made.

```sh
npx crowded-folders          # check the repository you are in
npx crowded-folders init     # write a configuration with the presets that fit it
```

Installed in a project (`npm install --save-dev crowded-folders`), the command is
`crowded-folders`, as in the rest of this page.

No Node? Each release has [a single-file binary](docs/distribution.md#binaries-no-node-needed) for Linux, macOS
and Windows (x64 and arm64 where it exists), and [Docker](docs/distribution.md#docker) is the official Node image
plus git.

No configuration needed to start, no runtime dependencies, any language: TypeScript, Python, Go,
Rust, Java, C#, Swift, C++, Unity, Unreal, Terraform, documentation sites, notebooks… Node
`^20.19 || ^22.13 || >=24` — ESLint 10's range, and the one CI tests from its floor (20.19) up. Node
21, 23 and 22.0 to 22.12 are outside it on purpose, so "Node 20 or later" is not quite it
([decisions.md](docs/decisions.md#node-2019-and-later)).

<!-- output: readme -->

```text
cli/
  ✖ error  prefix-groups  5 modules start with "render" (render-json, render-markdown, render-pr,
                          render-sarif, render-text): they are a folder that was never made —
                          cli/render/.

src/components/
  ✖ error  max-files      34 modules, over the limit of 20: split it into folders by what the files
                          are about.

✖ 2 errors, 0 warnings in 2 folders (4 folders and 40 files checked; 75 % of folders within the
  max-files limit (3/4)).
  --moves prints where each file could go; `crowded-folders explain cli` shows how a folder was
    read.
```

<!-- /output -->

## Why

Neither the compiler nor the linter looks at the shape of the tree, and it is the first thing a
newcomer reads. A folder of forty files is scrolled, not read. And eight files called `render-*.ts`
side by side are a folder that was never made: the prefix is doing the job the directory should.

Every style guide says "split folders by feature, and split them when they grow". None of the tools
that check folders could say _when_: they check the shape of names ([ls-lint](https://github.com/loeffel-io/ls-lint),
[eslint-plugin-check-file](https://github.com/dukeluo/eslint-plugin-check-file)) or a structure you
write out in full ([eslint-plugin-project-structure](https://github.com/Igorkowalski94/eslint-plugin-project-structure)).
crowded-folders counts, and reads names the way people write them.

## What it checks

| Rule                                                       | On in `recommended`             | Finds                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`max-files`](docs/rules/max-files.md)                     | error, 20 modules               | A folder with too many modules. A module is a file with its companions: `foo.ts`, `foo.spec.ts` and `foo.html` count once.    |
| [`prefix-groups`](docs/rules/prefix-groups.md)             | error, 4 modules                | Modules whose names start with the same word: `render-json`, `render-text`, `render-pr`, `render-sarif` → `render/`.          |
| [`redundant-prefix`](docs/rules/redundant-prefix.md)       | off (on in `strict`)            | Modules that repeat their folder's name: `render/render-json.ts` → `render/json.ts`.                                          |
| [`max-folders`](docs/rules/max-folders.md)                 | off (on in `strict`)            | A folder with too many subfolders.                                                                                            |
| [`single-file-folders`](docs/rules/single-file-folders.md) | off (warn in `strict`)          | A folder that holds a single file and nothing else.                                                                           |
| [`case-collision`](docs/rules/case-collision.md)           | off (on in `strict`)            | Names that differ only in case (`Components/`, `components/`): one name on Windows and macOS.                                 |
| [`scattered-feature`](docs/rules/scattered-feature.md)     | off                             | One word in every layer folder (`controller/RegistroController`, `service/RegistroService`, `dto/RegistroDto`) → `registro/`. |
| [`orphan-companions`](docs/rules/orphan-companions.md)     | off (error in `unity`, `godot`) | A Unity `.meta` or a Godot `.import` / `.uid` without its asset: every reference to it is broken.                             |
| [`type-folders`](docs/rules/type-folders.md)               | off (warn in `unreal`, `godot`) | A game folder named after an asset type: `Textures/`, `Materials/`, `Meshes/`.                                                |

Names are read in every convention — `user-service`, `user_service`, `userService`, `UserService`,
`HTTPServer` — so `UserService.java`, `user_service.py` and `user-service.ts` all start with `user`.
How, and why each choice: [docs/how-it-works.md](docs/how-it-works.md).

The limits are not guesses: 20 modules is about the median 95th percentile of folder sizes (19) measured
over 36 real repositories of every ecosystem ([docs/field-trial.md](docs/field-trial.md)). It flags about the
biggest folder in twenty, and nothing at all in small, tidy projects.

## Presets: the standard of each ecosystem

Conventions differ, and the tool must not fight them. Vue's style guide _asks_ for `TodoList.vue`,
`TodoListItem.vue` and `TodoListItemButton.vue` side by side; Android's `res/` folders cannot have
subfolders, so `activity_*` and `ic_*` are the only grouping there is; in Go a new folder is a new
package. Each preset follows its ecosystem's own guide, and says which:

| Field                           | Presets                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General                         | `recommended`, `strict`                                                                                                                                                   |
| Web                             | `angular`, `react`, `nextjs`, `react-native`, `vue`, `nuxt`, `svelte`, `nestjs`                                                                                           |
| Languages                       | `python`, `django`, `go`, `rust`, `java` (and Kotlin), `android`, `dotnet`, `swift`, `flutter`, `rails`, `php`, `elixir` (Phoenix), `scala`, `c-cpp`, `protobuf`, `bazel` |
| Games                           | `unity`, `unreal`, `godot`                                                                                                                                                |
| Infrastructure, documents, data | `terraform`, `docs`, `data-science`, `latex`                                                                                                                              |

`crowded-folders init` detects them; every preset, what it changes and its sources are in
[docs/presets.md](docs/presets.md). Plugins add more (`namespace/preset`), and a team can publish its
own as a shared configuration.

## Configuration

`crowded-folders init` writes the first two lines below, `$schema` (pinned to the major version) and
`extends` with the presets it detected, in `crowded-folders.config.json` (or `.config/crowded-folders.json`
when the repository keeps its tool configurations there; `--config <file>` says where). The rest is what a
configuration looks like once the team has made it its own:

```jsonc
// crowded-folders.config.json — comments are allowed
{
    "$schema": "https://unpkg.com/crowded-folders@1/schema.json",
    "extends": ["recommended", "react"],
    "rules": {
        "prefix-groups": ["error", { "ignore": ["check"] }],
    },
    "overrides": [
        {
            "folders": ["src/legacy/**"],
            "reason": "Being rewritten in Q3; do not reorganise what will be deleted.",
            "rules": { "max-files": "off" },
        },
    ],
}
```

It is found without `--config` or `--root`: from the folder the command runs in up to the top of the git
repository, the first `crowded-folders.config.{json,jsonc,js,mjs,cjs,ts,mts}`, `crowded-folders.json(c)`,
the same in `.config/` (`.config/crowded-folders.json`), or a `"crowded-folders"` key in `package.json`.
Paths in it start from the project folder (the one above `.config/`), not from where the command was typed
([where the configuration lives](docs/configuring.md#where-the-configuration-lives)).

Every override needs a `reason`: an exception without one cannot be reviewed, so the configuration does
not load without it. An override that no longer matches any folder is reported, so they do not rot.

The guide, with every case: [docs/configuring.md](docs/configuring.md). Every setting: [docs/configuration.md](docs/configuration.md).
To see how one folder was read and which settings apply to it: `crowded-folders explain src/components`.

## Adopting it in a repository that already has problems

```sh
npx crowded-folders --suppress-all     # record today's problems in crowded-folders-suppressions.json
```

From then on the run passes, new problems fail, and a suppressed folder may shrink but not grow. When
one gets better, the run asks you to `--prune-suppressions`, so the file only ever goes down.
Details: [docs/adopting.md](docs/adopting.md).

## In CI and in hooks

<!-- x-release-please-start-version -->

```yaml
# .github/workflows/structure.yml
- uses: actions/checkout@v7
- run: npx --yes crowded-folders@1.0.1 --format github # annotations on the pull request
```

<!-- x-release-please-end -->

Exit codes: `0` clean, `1` problems, `2` the configuration or the command line is wrong. SARIF for code
scanning, Markdown for a job summary, JSON for scripts, GitLab, pre-commit, husky and lefthook:
[docs/ci.md](docs/ci.md).

## For AI coding agents

```sh
npx crowded-folders where src/core/enums/foo-bar.enum.ts   # WORSE max-files 14→15 (limit 10)
npx crowded-folders init --agents                          # the Claude Code hook + a block for AGENTS.md
npx crowded-folders explain src/core/enums --prompt        # the reorganisation, as a task to paste
```

`where` says whether a file that does not exist yet would create, worsen or leave as it is a problem in its
folder, and which existing folder fits its name. The Claude Code hook asks it before every new file and warns
the agent without blocking it; the package also ships a skill and a plugin
([docs/agents.md](docs/agents.md)).

## Plugins

A plugin is an npm package that exports rules and presets; a rule is one function that looks at a
folder and reports. [examples/plugin](https://github.com/bymaksym/CrowdedFolders/tree/v1.0.1/examples/plugin) is a complete one to copy, and <!-- x-release-please-version -->
[docs/plugins.md](docs/plugins.md) explains every part, from the folder a rule receives to publishing.

```js
import { defineRule } from 'crowded-folders';

export const genericNames = defineRule({
    meta: { description: 'Folders are not named utils or helpers.', defaultOptions: {} },
    check(folder, { report }) {
        if (['utils', 'helpers'].includes(folder.name)) report({ message: `"${folder.name}" says nothing.` });
    },
});
```

## From code

```js
import { lint } from 'crowded-folders';

const { kept, exitCode } = await lint({ cwd: '/path/to/repo', suppressions: true });
```

`lint()` reads the configuration, detects the presets and applies the suppressions as the command does,
so `exitCode` is what the command would exit with. `createLinter()` loads it once for an editor or a
hook, `crowded-folders/engine` runs in a browser, and `crowded-folders/testing` has a `RuleTester` for
plugins: [docs/api.md](docs/api.md). `crowded-folders/eslint` is an ESLint plugin (flat config) that shows the
findings wherever ESLint runs: [docs/eslint.md](docs/eslint.md).

## The map and the badge

`crowded-folders tree` prints the folders as a tree with how near each is to its limit;
`crowded-folders -f html=map.html` writes one self-contained page with a zoomable treemap. The summary says
how many folders are within their limit, and `-f badge=badge.json` writes that figure as a
[shields.io endpoint](https://shields.io/badges/endpoint-badge):

```md
![folders within limit](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FOWNER%2FREPO%2Fbadges%2Fbadge.json)
```

More in [docs/tree.md](docs/tree.md).

## Words used here

- **Module**: a file with its companions, the files that share its stem: `button.tsx`, `button.spec.tsx` and
  `button.scss` are one module. `max-files` counts modules.
- **Stem**: a file name up to its first dot, without the companion part (`button.spec.tsx` → `button`).
- **Companion**: a file that goes with a module and is not counted apart: a test, a style, a template.
- **Group**: modules whose names start with the same word (`render-json`, `render-text`): a folder nobody made.
- **Subfolder**: a folder inside a folder. **Junk drawer**: a folder where everything ends up because nothing
  says where it goes.
- **`"warn"`** is the severity you write in a configuration; the report calls what it finds a **warning**.
  An **error** fails the run; a warning does not, unless `--max-warnings` says so.

## Documentation

| Page                                      | For                                                                |
| ----------------------------------------- | ------------------------------------------------------------------ |
| [configuring.md](docs/configuring.md)     | Writing a configuration: presets, overrides, naming, monorepos.    |
| [configuration.md](docs/configuration.md) | Every setting and every rule option (generated from the code).     |
| [presets.md](docs/presets.md)             | Every preset, what it changes and where it comes from (generated). |
| [rules/](docs/rules)                      | One page per rule, with examples.                                  |
| [adopting.md](docs/adopting.md)           | Starting in a repository that already has crowded folders.         |
| [ci.md](docs/ci.md)                       | GitHub Actions, GitLab, pre-commit, hooks, output formats.         |
| [agents.md](docs/agents.md)               | `where`, the Claude Code hook, the skill and the plugin.           |
| [tree.md](docs/tree.md)                   | The folder tree, the HTML map, the health figure and the badge.    |
| [plugins.md](docs/plugins.md)             | Writing and publishing rules and presets.                          |
| [api.md](docs/api.md)                     | Using it from JavaScript or TypeScript.                            |
| [distribution.md](docs/distribution.md)   | Binaries without Node, Docker, and the listings still to do.       |
| [eslint.md](docs/eslint.md)               | The ESLint plugin: editors, the ESLint MCP server, oxlint.         |
| [how-it-works.md](docs/how-it-works.md)   | How names are read, and why.                                       |
| [field-trial.md](docs/field-trial.md)     | The 36 repositories the limits were measured on.                   |
| [decisions.md](docs/decisions.md)         | Why it is built the way it is, and what was discarded.             |

## Community

[Discord — ByMaksymDev Labs](https://discord.gg/ctDJjFF9yT), where crowded-folders has its own
channel. Bugs and feature requests are better off as issues here, where they can be found again; the
chat is for everything that is a conversation.

## License

[MIT](LICENSE)
