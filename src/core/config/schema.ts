import { docsUrl } from '../docs-url.ts';
import type { Rule } from '../rules/rule.ts';
import type { JsonSchema } from './json-schema.ts';
import { EMPTY_CONFIG } from './types.ts';

export const SCHEMA_URL = 'https://unpkg.com/crowded-folders/schema.json';

/**
 * The schema of the version a configuration was written for: `crowded-folders@1` for 1.x, so that a major
 * version that renames a setting does not turn every editor red at once. Before 1.0 a minor is the
 * breaking one (`@0.5`).
 */
export function pinnedSchemaUrl(version: string): string {
    const [major = '0', minor = '0'] = version.split('.', 2);
    return `https://unpkg.com/crowded-folders@${major === '0' ? `0.${minor}` : major}/schema.json`;
}

/**
 * How long a reason has to be once trimmed. An opinion, not a measurement: long enough to say why
 * ("generated from the OpenAPI spec"), too long for a placeholder ("x", "ok", "legacy").
 */
export const MIN_REASON_LENGTH = 10;

const SEVERITY: JsonSchema = {
    enum: ['error', 'warn', 'off'],
    description: '"error" fails the run, "warn" reports without failing, "off" does not run the rule.',
};

/** What the editor offers for a preset: its name and what it changes. */
export type PresetNames = Readonly<Record<string, { readonly description: string }>> | readonly string[];

/**
 * A built-in preset: one choice for each, with its own description, so that the editor says what
 * `angular` or `unity` changes when it completes the name. Given only names, they get the same description.
 */
const isNameList = (presets: PresetNames): presets is readonly string[] => Array.isArray(presets);

function builtInPresets(presets: PresetNames): JsonSchema[] {
    const described: [string, string][] = isNameList(presets)
        ? presets.map((name): [string, string] => [name, 'A built-in preset.'])
        : Object.entries(presets).map(([name, preset]): [string, string] => [name, preset.description]);
    return described.map(([name, description]) => ({ const: name, description }));
}

const GLOBS = (description: string): JsonSchema => ({
    type: 'array',
    items: { type: 'string', minLength: 1 },
    description,
});

/** The `naming` settings: what `crowded-folders rules` lists beside the rules' options. */
const NAMING_SETTINGS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    description: 'How file names are read. Lists accumulate across presets; "!x" removes an inherited "x".',
    properties: {
        companions: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Regular expressions removed from each stem, so that companion files join their module: "_test$" makes foo_test.go part of foo.go; "^test_" makes test_foo.py part of foo.py.',
            examples: [['_test$'], ['^test_', '_test$'], ['Tests?$']],
        },
        ignoreLeadingWords: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Lowercase words skipped at the start of a name before reading what it is about: "i" for C# interfaces (IUserService), "bp" for Unreal blueprints (BP_Door).',
        },
        groupNumericPrefixes: {
            type: 'boolean',
            description: 'Whether names that start with a number (0001_initial, 2024-01-01-post) group by it.',
        },
        folderFiles: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Globs of file names that describe their folder instead of being one more thing in it, and are not counted: package-info.java, __init__.py, doc.go, mod.rs.',
            examples: [['package-info.java', 'module-info.java'], ['__init__.py']],
        },
        folderCompanions: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Endings that, after the name of a sibling folder, make a file that goes with that folder and is not counted: ".meta" makes the Scripts.meta of Unity part of Scripts/.',
            examples: [['.meta']],
        },
        folderCase: {
            enum: ['kebab', 'snake', 'camel', 'pascal', 'lower'],
            description:
                'How the folder a move proposes is written from the words of its group: "kebab" user-list, "snake" user_list, "camel" userList, "pascal" UserList (C# namespaces, PSR-4), "lower" userlist (Java and Go packages).',
        },
        reservedWords: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Words a folder cannot be called, because it would be a package or module name and the language reserves it (abstract in Java, async in Python, type in Go): a move proposes the plural (abstracts/), or no folder when that is reserved too. Compared with the folder name as folderCase writes it.',
            examples: [['abstract', 'import', 'package']],
        },
        keepInPlace: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                "Globs of paths (or of a folder above them) that a move never touches, because a tool reads them by name and place: Spring's application-*.yml, Flutter's main_*.dart, patch-package's patches. They are left out of the groups prefix-groups proposes and of what redundant-prefix renames.",
            examples: [['application-*.{yml,yaml,properties}'], ['patches']],
        },
        routes: {
            type: 'boolean',
            description:
                "Whether a file's path is its address (Expo Router's and Next.js's app/): a group then moves into a route group, (sign)/, which does not change the address, the names are kept, and redundant-prefix does not shorten them.",
        },
        groupFileStays: {
            type: 'boolean',
            description:
                'Whether the module named exactly like a group stays beside the folder it gets: in Rust, render.rs declares the module whose files go in render/ (render_json.rs → render/json.rs). When false, render.ts goes into render/.',
        },
        mirrors: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description:
                'Trees that mirror another one, as "source => mirror", where "**" stands for the part both share: "**/src/main/java/** => **/src/test/java/**". A problem found in both trees is reported once, in the source, and its moves take the mirrored files along.',
            examples: [['**/src/main/java/** => **/src/test/java/**'], ['lib/** => test/**']],
        },
    },
};

/**
 * The `naming` settings, each with the value it has when nothing sets it (`EMPTY_CONFIG`, what the engine
 * starts from), so that the editor, `rules` and `configuration.md` show the default that is used.
 */
export const NAMING: JsonSchema = {
    ...NAMING_SETTINGS,
    properties: Object.fromEntries(
        Object.entries(NAMING_SETTINGS.properties ?? {}).map(([name, setting]) => [
            name,
            { ...setting, default: (EMPTY_CONFIG.naming as unknown as Record<string, unknown>)[name] },
        ]),
    ),
};

/** The setting of one rule: its severity, or its severity and options. */
function ruleSetting(rule: Rule | undefined): JsonSchema {
    const options: JsonSchema = rule?.meta.options ?? { type: 'object' };
    return {
        ...(rule && { description: rule.meta.description }),
        anyOf: [SEVERITY, { type: 'array', items: [SEVERITY, options], minItems: 1, maxItems: 2 }],
    };
}

/** The options of a rule with their value when nothing sets them: the editor shows it next to each. */
function withDefaults(rule: Rule): Rule {
    const options = rule.meta.options;
    if (!options?.properties) {
        return rule;
    }
    const defaults = new Map(Object.entries(rule.meta.defaultOptions as Record<string, unknown>));
    const properties: Record<string, JsonSchema> = {};
    for (const [option, schema] of Object.entries(options.properties)) {
        properties[option] = defaults.has(option) ? { ...schema, default: defaults.get(option) } : schema;
    }
    return { ...rule, meta: { ...rule.meta, options: { ...options, properties } } };
}

function rulesSchema(rules: Readonly<Record<string, Rule>>): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    for (const [name, rule] of Object.entries(rules)) {
        properties[name] = ruleSetting(withDefaults(rule));
    }
    return {
        type: 'object',
        description: 'Rules by name, built-in or "namespace/rule" from a plugin.',
        properties,
        // Plugin rules are only known once the plugins load; they are checked then.
        additionalProperties: ruleSetting(undefined),
    };
}

/**
 * The JSON Schema of a configuration file. Published as `schema.json` and used to check every
 * configuration as it loads, so the editor and the command read the file the same way.
 */
export function configSchema(rules: Readonly<Record<string, Rule>>, presets: PresetNames): JsonSchema {
    const rulesProperty = rulesSchema(rules);
    return documented({
        $schema: 'https://json-schema.org/draft-07/schema#',
        $id: SCHEMA_URL,
        title: 'crowded-folders configuration',
        type: 'object',
        additionalProperties: false,
        properties: {
            $schema: { type: 'string', description: 'This schema, for editors.' },
            root: {
                type: 'boolean',
                description:
                    'false: the configuration of a package in a repository whose own configuration is above. Checked from the top, it applies to this folder (its patterns start here); checked from here, the top configuration is used, with its root and suppressions, and only this folder is checked. It cannot set plugins, include or suppressions. Default: true.',
            },
            extends: {
                type: 'array',
                items: {
                    anyOf: [
                        ...builtInPresets(presets),
                        {
                            type: 'string',
                            minLength: 1,
                            description: 'A plugin preset ("namespace/name"), a package or a file.',
                        },
                    ],
                },
                description: 'Presets and configurations applied before this one, in order; later ones win.',
            },
            plugins: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                uniqueItems: true,
                description: 'Packages or files whose default export is a plugin: more rules and presets.',
            },
            include: GLOBS(
                'Globs of the files looked at; like exclude, a pattern matches a file or any folder above it ("src" takes everything in src). Default: every file git knows about, or every file under the root without git.',
            ),
            exclude: GLOBS(
                'Globs of files and folders left out, on top of .gitignore. A pattern without "/" matches at any depth; "!x" removes an inherited x, and brings no file back.',
            ),
            naming: NAMING,
            rules: rulesProperty,
            overrides: {
                type: 'array',
                description: 'Settings for some folders only. Every override says why.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['folders', 'reason'],
                    properties: {
                        folders: {
                            type: 'array',
                            minItems: 1,
                            items: { type: 'string', minLength: 1 },
                            description:
                                'Globs matched against folder paths relative to the root; the root itself is ".".',
                        },
                        withFiles: {
                            type: 'array',
                            items: { type: 'string', minLength: 1 },
                            description:
                                'Globs of file names: the override applies only to the folders that hold one of them directly ("package.json" is the root of a package). Default: every folder matching "folders".',
                        },
                        extends: {
                            type: 'array',
                            items: {
                                anyOf: [
                                    ...builtInPresets(presets),
                                    {
                                        type: 'string',
                                        minLength: 1,
                                        description: 'A plugin preset ("namespace/name").',
                                    },
                                ],
                            },
                            description:
                                'Presets applied to these folders only, before the settings of the override: ["java"] under "server/**". Their root-anchored patterns ("/target") start at each folder of "folders", and their names match at any depth below it. Presets only: a file or package applies to the whole configuration.',
                        },
                        reason: {
                            type: 'string',
                            minLength: MIN_REASON_LENGTH,
                            description: `Why these folders are different, in at least ${MIN_REASON_LENGTH} characters once trimmed. Required: an override is a silence, and a silence without a reason cannot be reviewed.`,
                        },
                        expires: {
                            type: 'string',
                            pattern: String.raw`^\d{4}-\d{2}-\d{2}$`,
                            description:
                                'A date (YYYY-MM-DD, UTC) after which the override is reported as config/expired-override, a warning: it still applies, and says it is due for review.',
                            examples: ['2027-03-31'],
                        },
                        owner: {
                            type: 'string',
                            minLength: 1,
                            description: 'Who answers for it (a person or a team, such as @org/team): shown with it.',
                        },
                        ticket: {
                            type: 'string',
                            minLength: 1,
                            description:
                                'Where the work that removes it is tracked (an issue number or a link): shown with it.',
                        },
                        rules: rulesProperty,
                        naming: NAMING,
                    },
                },
            },
            suppressions: {
                type: 'string',
                minLength: 1,
                description:
                    'The suppressions file, relative to this configuration (default: crowded-folders-suppressions.json), or "per-project": one crowded-folders-suppressions.json in each project (the nearest folder with a package manifest, such as package.json, go.mod or Cargo.toml), its keys relative to the project.',
            },
        },
    });
}

/** The page of a setting, as of this version: a rule's own, or the reference. */
function pageOf(path: readonly string[]): string {
    const [first, second] = path;
    if (first === 'rules' && second !== undefined) {
        return docsUrl(path.length === 2 ? `rules/${second}.md` : `configuration.md#${second}`);
    }
    return docsUrl(`configuration.md#${first === 'naming' || first === 'overrides' ? first : 'top-level'}`);
}

/**
 * Gives each described setting a `markdownDescription` (what editors render in a hover): the same text,
 * its default, and a link to its page. The plain `description` stays for the editors that do not read Markdown.
 */
function documented(schema: JsonSchema, path: readonly string[] = []): JsonSchema {
    const walk = (child: JsonSchema, at: readonly string[], property: boolean): JsonSchema => {
        const one = documented(child, at);
        return property ? mark(one, at) : one;
    };
    return {
        ...schema,
        ...(schema.properties && {
            properties: Object.fromEntries(
                Object.entries(schema.properties).map(([name, child]) => [name, walk(child, [...path, name], true)]),
            ),
        }),
        ...(schema.items && {
            items: Array.isArray(schema.items)
                ? (schema.items as readonly JsonSchema[]).map(child => walk(child, path, false))
                : walk(schema.items as JsonSchema, path, false),
        }),
        ...(schema.anyOf && { anyOf: schema.anyOf.map(child => walk(child, path, false)) }),
    };
}

function mark(schema: JsonSchema, path: readonly string[]): JsonSchema {
    if (schema.description === undefined) {
        return schema;
    }
    const value = schema.default === undefined ? '' : `\n\nDefault: \`${JSON.stringify(schema.default)}\``;
    return { ...schema, markdownDescription: `${schema.description}${value}\n\n[Documentation](${pageOf(path)})` };
}
