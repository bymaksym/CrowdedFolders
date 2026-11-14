# Plugins

A plugin adds rules and presets. It is a package (or a local file) whose default export has this
shape:

```js
export default {
    meta: { name: 'crowded-folders-plugin-acme', namespace: 'acme', version: '1.0.0' },
    rules: { 'no-generic-names': rule },
    presets: { recommended: preset },
};
```

A configuration loads it and uses what it adds by `namespace/name`:

```jsonc
{
    "plugins": ["crowded-folders-plugin-acme"],
    "extends": ["recommended", "acme/recommended"],
    "rules": { "acme/no-generic-names": ["error", { "names": ["utils"] }] },
}
```

[examples/plugin](https://github.com/bymaksym/CrowdedFolders/tree/v1.0.1/examples/plugin) is a complete plugin to copy: one rule, one preset, <!-- x-release-please-version -->
typed with JSDoc, no build step. It is in the repository, not in the package: the link names the version.

## A rule

```js
import { defineRule } from 'crowded-folders';

export const noGenericNames = defineRule({
    meta: {
        description: 'Folders are not named after nothing in particular: utils, helpers, common.',
        url: 'https://github.com/acme/crowded-folders-plugin-acme#no-generic-names',
        defaultOptions: { names: ['utils', 'helpers', 'common'] },
        // JSON Schema of the options: checked when the configuration loads (see "Options" below).
        options: {
            type: 'object',
            additionalProperties: false,
            properties: { names: { type: 'array', items: { type: 'string' } } },
        },
    },
    check(folder, { options, report }) {
        if (options.names.includes(folder.name.toLowerCase())) {
            report({ message: `"${folder.name}" says nothing about what is inside.`, files: folder.files });
        }
    },
});
```

`check` is called once per folder, with:

| `folder.`          |                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `path`             | Relative to the root, `/`-separated; the root is `.`.                                                   |
| `name`, `depth`    | The last segment (`.` for the root); how deep it is (the root is 0).                                    |
| `files`, `folders` | Names of its files and subfolders, sorted.                                                              |
| `modules`          | Its files grouped: `{ stem, files, words, subject }` — see [how-it-works.md](how-it-works.md).          |
| `naming`           | The naming in effect here: `companions` (RegExp[]), `ignoreLeadingWords` (Set), `groupNumericPrefixes`. |

`options` are your `defaultOptions`, then what presets and the configuration set, then overrides for
this folder. Lists accumulate and `"!x"` removes, as everywhere.

`folder` and `options` are frozen, and shared by every rule and every folder in the same state: a rule
that sorts `folder.files`, pushes to `options.seen` or adds to `naming.ignoreLeadingWords` throws
instead of changing what the next rule or folder sees.

`report({ … })` takes:

| Field               |                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `message`           | What is wrong and what to do, in one or two sentences.                                                                        |
| `key`               | Tells apart two problems of the same rule in one folder. It is part of what a suppression remembers, so it must be stable.    |
| `measured`, `limit` | The number that broke the limit, and the limit. A suppression lets `measured` stay or drop, not grow.                         |
| `files`             | File names in the folder the problem is about; the first is where annotations and SARIF point.                                |
| `moves`             | `{ from, to }` paths relative to the root, printed by `--moves`. Never applied.                                               |
| `severity`          | `"warn"` to report this problem as a warning where the rule is an error (a second, lower limit). Never harsher than the rule. |

What `report()` gets is checked before it reaches a report, SARIF or an annotation: a `message` that is
text, `measured` and `limit` of at least 0, and `files` and `moves` that are relative paths without
`..` (`files: ['../../etc/passwd']` stops the run).

A rule that proposes moves can ask `existing(path)` (in the second argument, next to `report`) for
the file or folder at a path as the tree writes it, compared without case: a move must not land on
`Text.ts` with `text.ts`, which Windows and macOS take for the same file. `folder.naming` also
carries what decides a destination: `folderCase`, `reservedWords`, `keepInPlace`, `routes`.

`inRepository(path)` says whether a file or folder is in the repository at all, whether or not
`include` and `exclude` keep it: Unity's `Plugins.meta` still has its folder when `Plugins/` is left out
of the check ([`orphan-companions`](rules/orphan-companions.md) asks it).

Helpers exported for rules: `splitWords`, `stemOf`, `groupKeyOf`, `modulesOf`.

**A rule must be pure:** no file reads, no network, no state between calls. It sees paths only, the
same as the built-in rules, and that is what keeps the tool fast and safe to run on any repository.

**And synchronous:** an `async check` is refused when the plugin loads, and a `check` that returns a
promise stops the run ("check must be synchronous"): what it reported after the promise settled would
be lost without a word.

When a rule throws, the run stops with exit code 2 and says whose it is, not that crowded-folders
broke:

```text
crowded-folders: acme/no-generic-names failed in src/utils: Cannot read properties of undefined (report it to crowded-folders-plugin-acme)
```

### Options

`meta.options` is JSON Schema, and the validator checks exactly these keywords: `type`, `enum`,
`const`, `properties`, `required`, `additionalProperties`, `propertyNames`, `items`,
`additionalItems`, `minItems`, `maxItems`, `uniqueItems`, `minimum`, `maximum`, `minLength`,
`pattern`, `anyOf` (plus `title`, `description`, `markdownDescription`, `default`, `examples`,
`definitions`, `$schema`, `$id`, which describe). A schema with any other — `oneOf`,
`exclusiveMinimum`, `$ref` — is refused when the plugin loads: the validator would skip it, and any
value would pass. Your `defaultOptions` must fit your schema too.

### A rule about the tree

`check` sees one folder. A rule that needs the whole tree — how deep it goes, `render.ts` next to a
`render/` folder — uses `create` instead, as in ESLint: it is called once per run, keeps what it sees
in its closure, and reports from `done` naming the folder.

```js
export const maxDepth = defineRule({
    meta: { description: 'The tree is at most 6 folders deep.', defaultOptions: { max: 6 } },
    create({ report }) {
        let deepest;
        let max = 6;
        return {
            folder(folder, { options }) {
                max = options.max;
                if (!deepest || folder.depth > deepest.depth) deepest = folder;
            },
            done() {
                if (deepest && deepest.depth > max) {
                    report({
                        folder: deepest.path,
                        message: `${deepest.depth} folders deep.`,
                        measured: deepest.depth,
                        limit: max,
                    });
                }
            },
        };
    },
});
```

`folder(view, context)` gets what `check` gets. A problem from `done` takes the severity the rule has
in that folder, and nothing where it is off; a folder the run did not look at is an error. A rule has
one of `check` and `create`, not both. Each run calls `create` again, so nothing is kept between runs.

## A preset

```js
import { definePreset } from 'crowded-folders';

export const recommended = definePreset({
    description: "Acme's layout: features in src/features, 12 modules per folder.",
    sources: [{ title: 'Acme engineering handbook: folders', url: 'https://acme.example/handbook/folders' }],
    detect: { dependencies: ['@acme/framework'] },
    config: {
        extends: ['recommended'],
        rules: { 'max-files': ['error', { max: 12 }], 'acme/no-generic-names': 'warn' },
    },
});
```

`sources` is required: a preset says where its criterion comes from. If it is your own opinion, say so
in the description — the built-in `strict` does.

## Testing it

`crowded-folders/testing` has a `RuleTester`, as ESLint does:

```js
import { describe, it } from 'node:test';
import { RuleTester } from 'crowded-folders/testing';
import plugin from './index.js';

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester().run('acme/no-generic-names', plugin.rules['no-generic-names'], {
    valid: [['src/user/a.ts'], { files: ['src/legacy/a.ts'], options: { names: ['misc'] } }],
    invalid: [
        {
            name: 'a utils folder',
            files: ['src/utils/a.ts', 'src/user/b.ts'],
            errors: [{ folder: 'src/utils', message: /says nothing/u }],
        },
    ],
});
```

Each case is a repository as a list of paths, the rule's `options` (checked against its schema), and
for `invalid` the problems it expects — or how many. Besides what each case expects, it checks what
every rule must be: a valid rule (meta, one of `check` and `create`, a schema whose every keyword is
checked), synchronous, and pure — the same case run twice reports the same, and a `check` rule reports
in a folder what it reports when that folder is checked alone. Without `describe` and `it` set, `run`
runs every case and throws a `RuleTestError` on the first that fails, in any test runner.

`lint()` works for a test too, when the configuration around the rule matters:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from 'crowded-folders';
import plugin from './index.js';

test('reports a utils folder', async () => {
    const result = await lint({
        config: { rules: { 'acme/no-generic-names': 'error' } },
        rules: { 'acme/no-generic-names': plugin.rules['no-generic-names'] },
        files: ['src/utils/a.ts', 'src/user/b.ts'],
    });
    assert.deepEqual(
        result.findings.map(finding => finding.folder),
        ['src/utils'],
    );
});
```

`files` stands in for a repository, so a test needs no folders on disk.

## Publishing

- **Name:** `crowded-folders-plugin-<name>` or `@scope/crowded-folders-plugin[-<name>]`, with the keyword
  `crowded-folders-plugin` so it can be found.
- **`peerDependencies`:** `"crowded-folders": "^1.0.0"`, not a dependency: the plugin uses the user's copy.
  It is read when the plugin loads: a plugin whose range does not take the running version is refused
  with both versions, instead of failing halfway through a run.
- **`exports`:** a `"."` entry with an `import` or `default` condition; subpath patterns (`"./*"`) work.
  The package is resolved from the folder of the configuration that names it — its `node_modules`, else
  Yarn Plug'n'Play, else Node's own resolution from there — so users install it as a devDependency next
  to it.
- **Namespace:** lowercase letters, digits and `-`. Two plugins with the same namespace is an error.

## Security

A plugin is code, and it runs when the configuration loads — as an ESLint plugin does. Install the ones
you would install as a devDependency anyway, and pin them. A JSON configuration without `plugins` runs
no code from outside this package.
