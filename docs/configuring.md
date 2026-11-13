# Configuring crowded-folders

Every setting, with its type and default, is in [configuration.md](configuration.md), which is generated
from the code. This page is how to use them.

## Where the configuration lives

The first of these found, from the current folder upwards to the top of the git repository:

| File                                                                           | Notes                                                                                                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `crowded-folders.config.json`                                                  | What `init` writes. Comments and trailing commas are allowed.                                                                                 |
| `crowded-folders.config.jsonc`                                                 | The same, for editors that only accept comments in `.jsonc`.                                                                                  |
| `crowded-folders.config.mjs`, `.js`, `.cjs`                                    | A module whose default export is the configuration, or a function returning it.                                                               |
| `crowded-folders.config.ts`, `.mts`                                            | The same in TypeScript, where Node runs it (22.18 and later; 22.6 with `--experimental-strip-types`). On Node 20 it is an error that says so. |
| `crowded-folders.json`, `.jsonc`                                               | The name people guess first.                                                                                                                  |
| `.config/crowded-folders.json`, `.jsonc`, `.mjs`, `.js`, `.cjs`, `.ts`, `.mts` | For repositories that keep tool settings in `.config/`.                                                                                       |
| `package.json` → `"crowded-folders"`                                           | A key, for a small project.                                                                                                                   |

Two of them in the same folder is an error: one would be read and the other ignored in silence. A file
that looks like one and is not (`crowded-folders.yaml`, `.crowded-foldersrc`) is pointed out when no
configuration is found. A key written twice in a JSON configuration is an error, not the second
winning in silence. `--config <file>` names one explicitly.

`--no-code` reads only JSON: a JavaScript configuration, an extended module and a plugin are errors
instead of code that runs. It is for checking a repository you do not trust (a bot, a
`pull_request_target` workflow). Without it, a configuration is still checked whole before any of its
plugins is imported.

**The root** — the folder whose files are checked — is the folder of the configuration (the folder
above `.config/`), not the folder the command was typed in. Without a configuration it is the top of
the git repository. `--root` sets it, and the configuration is then looked for from there: `--root
../other` reads other's configuration and plugins. When the root is inside the configuration's folder
(`--root android` under a configuration in the folder above), the configuration's patterns still start
at its own folder, `/android` keeps meaning that folder, and the report names folders from there too.
A run with `--root` says which configuration and root it used.

Paths given to options (`--config`, `--root`, `--output`, `--suppressions-location`) and folders given
as arguments start from the current folder, as in most commands. `suppressions` in the configuration
starts from the configuration's folder.

## Starting from presets

```jsonc
{
    "$schema": "https://unpkg.com/crowded-folders@1/schema.json",
    "extends": ["recommended", "react"],
}
```

`extends` takes built-in presets, plugin presets (`namespace/preset`), packages
(`@acme/crowded-folders-config`) and files (`./base.json`). They apply in order, later ones win, and each
is applied once, however many times it is reached: `["react", "strict"]` applies `recommended` (which
both extend) a single time. Because of that, a preset listed after one that already brought it does
nothing, and says so: `["angular", "recommended"]` warns that `recommended` was already applied by
`angular` — put it first, or remove it.

`strict` tightens the presets it is combined with, wherever it is written: `["strict", "go"]` and
`["go", "strict"]` give the same limits (12 modules), and it leaves alone what a preset keeps as its
ecosystem needs it (`java` and `dotnet` keep `redundant-prefix` off, since `user/UserService` is how they
name classes; `go`'s `main.go` and Cargo's `lib.rs` stay allowed alone in a folder). The configuration's
own `rules` still decide over both.

A plain name (no `/`, `@` or `.`) close to a preset is a misspelled preset: `"recomended"` gets "did you
mean recommended?", never an instruction to install a package of that name.

Without any configuration the command detects the presets and says which it used; `init` writes them
down so the choice is visible and reviewed. Files inside tests, examples, playgrounds and templates
are not evidence (a `go.mod` among test fixtures does not make a Go repository), and a
`requirements.txt` is Python only with Python files next to it (mkdocs keeps one in `docs/`). A preset
found only in subfolders (a `pom.xml` in `server/`) applies there, in an override with `extends`
(see [Monorepos](#monorepos)); one found at the root goes in `extends`, and its root-anchored excludes
are read from every folder it was found in (a Flutter app in `app/` gets `app/android`, `app/ios`). A
preset that puts back what `recommended` leaves out (the game presets count media) always goes in
`extends`.

`--preset` adds to what is detected, after it (so it wins); `--no-detect` uses only the presets given.

## Rules

```jsonc
{
    "rules": {
        "max-files": ["error", { "max": 25 }],
        "prefix-groups": "warn",
        "redundant-prefix": "error",
    },
}
```

A bare severity (`"error"`, `"warn"`, `"off"`) keeps the options set by the presets; `[severity, options]`
merges new options over them. Warnings are printed but never fail the run unless `--max-warnings` says
so.

## Lists accumulate; `!` removes

`exclude`, `include`, `naming.companions`, `naming.ignoreLeadingWords` and the lists inside rule options
(`prefix-groups.ignore`) add to what the presets set. To take something out, write it with `!`:

```jsonc
{
    "extends": ["recommended"],
    // recommended leaves dist/ out; this repository commits a hand-written one.
    "exclude": ["!dist"],
    "rules": {
        // recommended does not group "get…"; this codebase uses Get* for a real family.
        "prefix-groups": ["error", { "ignore": ["!get"] }],
    },
}
```

## Overrides: settings for some folders

```jsonc
{
    "overrides": [
        {
            "folders": ["src/generated/**", "src/legacy"],
            "reason": "Generated from the OpenAPI spec; its shape is the generator's.",
            "rules": { "max-files": "off", "prefix-groups": "off" },
            "owner": "@acme/api",
            "ticket": "API-142",
            "expires": "2027-06-30",
        },
        {
            "folders": ["packages/*/src/components"],
            "reason": "Design-system components are many small siblings by design.",
            "rules": { "max-files": ["error", { "max": 60 }] },
            "naming": { "ignoreLeadingWords": ["base"] },
        },
    ],
}
```

- `folders` are globs matched against **folder** paths relative to the root (the root is `.`).
- `withFiles` (optional) narrows the override to the folders that hold one of those files directly: `"folders": ["**"], "withFiles": ["package.json"]` is the root of every package, which is how `recommended` gives it the limit of the root of the repository.
- `reason` is required, and is shown by `crowded-folders explain`. An override is a silence; a silence
  without a reason cannot be reviewed, and nobody knows a year later whether it still holds. It is
  trimmed and needs at least 10 characters (an opinion: enough for "generated from the spec", not for
  "x" or "legacy").
- `expires` (`YYYY-MM-DD`, UTC), `owner` and `ticket` (optional) say when to look again, who answers for
  it and where its removal is tracked. Past `expires` the override still applies — a date must not turn
  a build red on its own — and the run warns `config/expired-override`, naming the owner and the ticket.
- `folders` and `withFiles` take no `"!"`: an override applies to every folder its globs match, so name
  the folders it is for.
- Overrides apply in order, after the global settings; several can match one folder.
- An override in your configuration that matches no folder is reported as a warning
  (`config/unused-override`), so they are removed when the folder is.

## Globs

| Pattern       | Matches                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `fixtures`    | a file or folder called `fixtures` at any depth (no `/`: like `.gitignore`) |
| `/data`       | only the `data` at the root                                                 |
| `src/*.ts`    | `.ts` files directly in `src`                                               |
| `src/**/test` | `src/test`, `src/a/test`, `src/a/b/test`                                    |
| `src/app/**`  | `src/app` and everything under it, as minimatch reads it                    |
| `*.{png,svg}` | either extension                                                            |
| `[!_]*`       | names not starting with `_`                                                 |
| `.*/`         | in `exclude` and `include`, folders only: `.github/`, not `.eslintrc`       |

`exclude` and `include` match a path or any folder above it: excluding `fixtures` leaves out
everything inside, and `"include": ["src"]` takes everything under `src`. An `include` that takes no
file is an error, and an entry of your `exclude` or `include` that matches no file is a warning.

`"!x"` in `exclude` takes out an `x` inherited from a preset; it is not a gitignore negation and brings
no file back. One that removes nothing is a warning.

`recommended` excludes `.*`: dot-folders (`.github`, `.vscode`) and dot-files (`.eslintrc`, `.env`) alike,
so no rule sees a dot-file. To count them with `max-files`' `dotfiles: true`, leave out only the folders:
`"exclude": ["!.*", ".*/"]`. A run with `dotfiles: true` and `.*` still in `exclude` says so.

## Naming

Most repositories need none of this: the presets set it. It is for a convention the presets do not
know.

```jsonc
{
    "naming": {
        // Our tests are FooCheck.kt next to Foo.kt.
        "companions": ["Check$"],
        // Every model is prefixed with the product code: XYZOrder, XYZInvoice.
        "ignoreLeadingWords": ["xyz"],
        // Our numbered steps are a family: 01-intro, 01-setup.
        "groupNumericPrefixes": true,
    },
}
```

- **companions** are regular expressions removed from each stem, again and again until nothing
  changes, so `foo_linux_amd64_test` becomes `foo` with the Go preset.
- **ignoreLeadingWords** are skipped before reading what a file is about: `IUserService` is about
  `user` once `i` is ignored.
- `crowded-folders explain <folder>` prints, for every file, the stem, the words and the group the tool
  read. It is the quickest way to see whether a setting does what you meant.

The rest of `naming` says where `--moves` may put a file, and the presets set it per language
([prefix-groups.md](rules/prefix-groups.md#moves)):

```jsonc
{
    "naming": {
        // Folders as our packages are written: user_role/, not user-role/.
        "folderCase": "snake",
        // Never a folder no import can name.
        "reservedWords": ["async", "import"],
        // A tool reads these by name and place.
        "keepInPlace": ["config/settings-*.toml"],
        // Our integration tests copy the package tree: one problem for both, and both move.
        "mirrors": ["src/** => it/**"],
    },
}
```

- **mirrors** are `"source => mirror"`, where `**` stands for the part both trees share, at the start,
  the end or both: `"**/src/main/java/** => **/src/test/java/**"`, `"** => **/__tests__"`.
- **routes** (`true` under Expo Router's and Next.js's `app/`) moves a group into a route group,
  `(sign)/`, keeping its names; **groupFileStays** (Rust) leaves `render.rs` beside `render/`.

## Configuration in JavaScript

```js
// crowded-folders.config.mjs
import { defineConfig } from 'crowded-folders';

export default defineConfig({
    extends: ['recommended', 'go'],
    overrides: process.env.CI
        ? []
        : [{ folders: ['scratch'], reason: 'local experiments', rules: { 'max-files': 'off' } }],
});
```

`defineConfig` only gives types. Prefer JSON when you can: it can be read by editors, by `$schema`,
and by people who do not run the code.

## Monorepos

One configuration at the root checks the whole repository. A preset that fits one part of it goes in
an override with `extends`, so that it applies there only:

```jsonc
{
    "extends": ["recommended"],
    "overrides": [
        { "folders": ["server/**"], "extends": ["java"], "reason": "The Spring server, built with Maven" },
        { "folders": ["web/**"], "extends": ["angular"], "reason": "The Angular app, with its own CLI" },
        {
            "folders": ["services/**"],
            "extends": ["go"],
            "reason": "Go services: one package per folder",
            "rules": { "max-files": ["error", { "max": 25 }] },
        },
    ],
}
```

- The presets of an override apply to its folders before the override's own settings, and over the
  configuration's `rules` there. Their root-anchored patterns start at each folder (`java`'s `/build`
  is `server/build`), and their plain names match at any depth below it (`react`'s `public` is
  `web/**/public`, so a NestJS `services/api/src/public/` is still checked). `"!x"` in a preset
  applied this way cannot take `x` out for some folders only, and says so.
- `overrides[].extends` takes presets only; a file or a package applies to the whole configuration.
- `init` writes one such override for each preset found in a subfolder only (a `pom.xml` in `server/`,
  an Angular `package.json` in `web/`), and `extends` for the ones found at the root.

### A configuration in a package

A package can keep its own configuration, marked `"root": false`:

```jsonc
// apps/web/crowded-folders.config.json
{
    "root": false,
    "extends": ["react"],
    "rules": { "max-files": ["error", { "max": 15 }] },
}
```

- Checked from the top of the repository, it applies to `apps/web` and below, and its patterns start
  at `apps/web`.
- Checked from `apps/web`, the configuration at the top is used — its root, its suppressions file —
  and only `apps/web` is checked: the keys of the suppressions are the same either way.
- It cannot set `plugins`, `include` or `suppressions`: those belong to the configuration at the top.
- A configuration in a package without `"root": false` is read only when the command runs from that
  package; checked from the top, the run says it is not read.
- `"root": false` is read from JSON configurations when looking for the top one; a JavaScript
  configuration in a package is always a root of its own.

`--project <dir>` checks one package with the repository's configuration and suppressions (the
configuration found from the top of the git repository), whatever folder the command is typed in: the
task of a package in Nx or Turbo.

```jsonc
// project.json (Nx)
{ "targets": { "folders": { "command": "crowded-folders --project {projectRoot}" } } }
```

### A shared base configuration

A `base.json` at the top of the repository, extended from a package (`"extends": ["../../base.json"]`),
wrote its globs from its own folder: they are read from there. From `packages/a`,
`packages/*/src/legacy/**` is `src/legacy/**`, and `packages/b/**` matches nothing. The overrides of a
file of the repository that the configuration extends from its own folder or below are the user's own:
one that matches no folder is reported, like those of the configuration itself.

To check only some folders of a run, pass them: `crowded-folders apps/web services/api`.

## Sharing a configuration

A shared configuration is a package (or a file) whose default export is a configuration:

```js
// @acme/crowded-folders-config/index.js
export default {
    extends: ['recommended'],
    rules: { 'max-files': ['error', { max: 15 }] },
};
```

```jsonc
{ "extends": ["@acme/crowded-folders-config"] }
```

It is resolved from the folder of the configuration that names it, so it has to be installed there
(a devDependency). A package that adds rules is a plugin: [plugins.md](plugins.md).
