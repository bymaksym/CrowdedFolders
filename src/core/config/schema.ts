import type { Rule } from '../rules/rule.ts';
import type { JsonSchema } from './json-schema.ts';

export const SCHEMA_URL = 'https://unpkg.com/crowded-folders/schema.json';

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
        folderCase: {
            enum: ['kebab', 'snake', 'camel', 'pascal', 'lower'],
            description:
                'How the folder a move proposes is written from the words of its group: "kebab" user-list (default), "snake" user_list, "camel" userList, "pascal" UserList (C# namespaces, PSR-4), "lower" userlist (Java and Go packages).',
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
                "Whether a file's path is its address (Expo Router's and Next.js's app/): a group then moves into a route group, (sign)/, which does not change the address, the names are kept, and redundant-prefix does not shorten them. Default: false.",
        },
        groupFileStays: {
            type: 'boolean',
            description:
                'Whether the module named exactly like a group stays beside the folder it gets: in Rust, render.rs declares the module whose files go in render/ (render_json.rs → render/json.rs). Default: false: render.ts goes into render/.',
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
                        reason: {
                            type: 'string',
                            minLength: 1,
                            description:
                                'Why these folders are different. Required: an override is a silence, and a silence without a reason cannot be reviewed.',
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
