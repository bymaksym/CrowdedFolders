import type { Rule, Severity } from '../rules/rule.ts';

/** `"error"`, or `["error", { …options }]`. */
export type RuleSetting = Severity | readonly [Severity] | readonly [Severity, Readonly<Record<string, unknown>>];

/**
 * How file names are read. Every list accumulates across `extends`, presets and overrides; an entry
 * written as `"!x"` removes `x` from what was inherited.
 */
export interface NamingConfig {
    /** Regular expressions; what each matches is removed from a stem, so that companions join their module. */
    readonly companions?: readonly string[];
    /** Lowercase words skipped at the start of a name before reading its subject (`i`, `bp`). */
    readonly ignoreLeadingWords?: readonly string[];
    /** Whether `0001_x` and `2024-01-01-x` group by their number. Default: false. */
    readonly groupNumericPrefixes?: boolean;
    /** Globs of file names that describe their folder and are not counted: `package-info.java`, `__init__.py`. */
    readonly folderFiles?: readonly string[];
    /** Endings that make a file go with the sibling folder of that name, uncounted: Unity's `.meta`. */
    readonly folderCompanions?: readonly string[];
    /** How a folder that a move proposes is written: `user-list` (kebab, the default), `user_list`, `userList`, `UserList`, `userlist`. */
    readonly folderCase?: FolderCase;
    /** Words a folder cannot be called in this language (`abstract` in Java, `async` in Python): a move proposes the plural, or no folder. */
    readonly reservedWords?: readonly string[];
    /** Globs of paths a move never touches, because a tool reads them by name and place: `application-*.yml`, `patches`. */
    readonly keepInPlace?: readonly string[];
    /** Whether a file's path is its address (Expo Router's `app/`): a group moves into a route group, `(sign)/`, keeping its names. */
    readonly routes?: boolean;
    /** Whether the module named like a group stays beside its new folder (Rust: `render.rs` next to `render/json.rs`). */
    readonly groupFileStays?: boolean;
    /** Trees that mirror another one, as `"source => mirror"`, `**` standing for the part they share: `"src/main/java/** => src/test/java/**"`. */
    readonly mirrors?: readonly string[];
}

/** How a folder name is written from its words. */
export type FolderCase = 'camel' | 'kebab' | 'lower' | 'pascal' | 'snake';

/** Settings for some folders only. Every override says why: it is a silence, and silences carry their reason. */
export interface OverrideConfig {
    /** Globs matched against folder paths (the root is `.`). */
    readonly folders: readonly string[];
    /**
     * Globs of file names: when given, the override applies only to the folders (of those matching `folders`)
     * that hold one of these files directly. It is how "the root of a package" is said: the folder with a package.json.
     */
    readonly withFiles?: readonly string[];
    readonly reason: string;
    readonly rules?: Readonly<Record<string, RuleSetting>>;
    readonly naming?: NamingConfig;
}

/** What a configuration file holds. Every field is optional. */
export interface Config {
    readonly $schema?: string;
    /** Built-in presets (`recommended`, `react`), plugin presets (`namespace/name`), packages or files. */
    readonly extends?: readonly string[];
    /** Packages or files that export a plugin. */
    readonly plugins?: readonly string[];
    /** Globs of the files looked at. Default: everything. */
    readonly include?: readonly string[];
    /** Globs of files and folders left out, on top of `.gitignore`. */
    readonly exclude?: readonly string[];
    readonly naming?: NamingConfig;
    readonly rules?: Readonly<Record<string, RuleSetting>>;
    readonly overrides?: readonly OverrideConfig[];
    /** Where the suppressions file is, relative to the configuration (default: `crowded-folders-suppressions.json`), or `"per-project"`: one in each project. */
    readonly suppressions?: string;
}

/** A link to where a preset's criterion comes from. */
export interface Source {
    readonly title: string;
    readonly url: string;
}

/** A named configuration that says where its numbers and conventions come from. */
export interface Preset {
    readonly description: string;
    /**
     * The style guides and conventions it follows. A preset without a source is an opinion; say so in `description`.
     */
    readonly sources: readonly Source[];
    readonly config: Config;
    /** When `init` (or a run without configuration) proposes it. */
    readonly detect?: Detect;
}

/** A preset applies to a repository when any of these is found in it. */
export interface Detect {
    /** Globs matched against the repository's file paths. */
    readonly files?: readonly string[];
    /** Package names in any package.json's dependencies or devDependencies. */
    readonly dependencies?: readonly string[];
}

/**
 * What a plugin package exports by default. Rules are used as `namespace/rule`, presets as
 * `namespace/preset` in `extends`.
 */
export interface Plugin {
    readonly meta: {
        /** The package name, for messages. */
        readonly name: string;
        /** Lowercase, `[a-z0-9-]`: the part before the slash in rule and preset names. */
        readonly namespace: string;
        readonly version?: string;
    };
    readonly rules?: Readonly<Record<string, Rule>>;
    readonly presets?: Readonly<Record<string, Preset>>;
}

/** A rule as it stands after every layer: severity, and the options set so far (defaults not included). */
export interface RuleState {
    readonly severity: Severity;
    readonly options: Readonly<Record<string, unknown>>;
}

/** The naming after every layer, as lists. */
export interface NamingState {
    readonly companions: readonly string[];
    readonly ignoreLeadingWords: readonly string[];
    readonly groupNumericPrefixes: boolean;
    readonly folderFiles: readonly string[];
    readonly folderCompanions: readonly string[];
    readonly folderCase: FolderCase;
    readonly reservedWords: readonly string[];
    readonly keepInPlace: readonly string[];
    readonly routes: boolean;
    readonly groupFileStays: boolean;
    readonly mirrors: readonly string[];
}

export interface OverrideState {
    readonly folders: readonly string[];
    readonly withFiles: readonly string[];
    readonly reason: string;
    readonly rules: Readonly<Record<string, RuleSetting>>;
    readonly naming: NamingConfig;
    /** The file or preset it was written in: stale overrides are only reported for the user's own files. */
    readonly origin: string;
    readonly own: boolean;
}

/** A configuration with every `extends` applied, ready for the engine. */
export interface ResolvedConfig {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
    readonly naming: NamingState;
    readonly rules: Readonly<Record<string, RuleState>>;
    readonly overrides: readonly OverrideState[];
    /** The presets and files applied, in order, for `print-config`. */
    readonly layers: readonly string[];
    readonly suppressions: string | undefined;
}

export const EMPTY_CONFIG: ResolvedConfig = {
    include: [],
    exclude: [],
    naming: {
        companions: [],
        ignoreLeadingWords: [],
        groupNumericPrefixes: false,
        folderFiles: [],
        folderCompanions: [],
        folderCase: 'kebab',
        reservedWords: [],
        keepInPlace: [],
        routes: false,
        groupFileStays: false,
        mirrors: [],
    },
    rules: {},
    overrides: [],
    layers: [],
    suppressions: undefined,
};
