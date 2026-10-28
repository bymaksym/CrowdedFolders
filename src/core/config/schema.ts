import type { Rule } from '../rules/rule.ts';
import type { JsonSchema } from './json-schema.ts';

export const SCHEMA_URL = 'https://unpkg.com/crowded-folders/schema.json';

/**
 * How long a reason has to be once trimmed. An opinion, not a measurement: long enough to say why
 * ("generated from the OpenAPI spec"), too long for a placeholder ("x", "ok", "legacy").
 */
export const MIN_REASON_LENGTH = 10;

const SEVERITY: JsonSchema = {
    enum: ['error', 'warn', 'off'],
    description: '"error" fails the run, "warn" reports without failing, "off" does not run the rule.',
};

const GLOBS = (description: string): JsonSchema => ({
    type: 'array',
    items: { type: 'string', minLength: 1 },
    description,
});

const NAMING: JsonSchema = {
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
            description:
                'Whether names that start with a number (0001_initial, 2024-01-01-post) group by it. Default: false.',
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
    },
};

/** The setting of one rule: its severity, or its severity and options. */
function ruleSetting(rule: Rule | undefined): JsonSchema {
    const options: JsonSchema = rule?.meta.options ?? { type: 'object' };
    return {
        ...(rule && { description: rule.meta.description }),
        anyOf: [SEVERITY, { type: 'array', items: [SEVERITY, options], minItems: 1, maxItems: 2 }],
    };
}

function rulesSchema(rules: Readonly<Record<string, Rule>>): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    for (const [name, rule] of Object.entries(rules)) {
        properties[name] = ruleSetting(rule);
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
export function configSchema(rules: Readonly<Record<string, Rule>>, presets: readonly string[]): JsonSchema {
    const rulesProperty = rulesSchema(rules);
    return {
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
                        { enum: presets, description: 'A built-in preset.' },
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
                                    { enum: presets, description: 'A built-in preset.' },
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
    };
}
