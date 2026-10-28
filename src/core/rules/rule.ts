import type { JsonSchema } from '../config/json-schema.ts';
import type { Module, Naming, Uncounted } from '../naming/modules.ts';
import { compileGlob } from '../paths/glob.ts';
import type { FolderEntry } from '../paths/tree.ts';

export type Severity = 'error' | 'off' | 'warn';

/**
 * A rule looks at the folders and reports what it finds. Built-in rules and plugin rules have
 * exactly this shape; nothing about the built-in ones is special.
 *
 * It has one of two forms. `check` looks at one folder at a time, and is all most rules need.
 * `create`, as in ESLint, is called once per run and returns what to do with each folder and at the
 * end: a rule about the tree (how deep it goes, `render.ts` next to `render/`) keeps what it saw in
 * the closure and reports from `done`. Either form must be synchronous and pure: what it reports
 * depends on the folders it is given, nothing else, and it keeps nothing from one run to the next.
 */
export interface Rule<Options extends object = object> {
    readonly meta: RuleMeta<Options>;
    /** Called once for each folder. */
    check?(folder: FolderView, context: RuleContext<Options>): void;
    /** Called once per run, before the first folder; what it returns is called for each folder, then `done`. */
    create?(context: TreeContext): RuleVisitor<Options>;
}

/** What `create` returns: called for each folder (as `check` would be), then once at the end. */
export interface RuleVisitor<Options extends object = object> {
    folder?(folder: FolderView, context: RuleContext<Options>): void;
    /** After the last folder. What it reports names its folder. */
    done?(): void;
}

/** What `create` receives: a `report` that says which folder each problem is about. */
export interface TreeContext {
    /**
     * Reports a problem in any folder the run looked at (`folder`, relative to the root). It takes the
     * severity the rule has in that folder, and nothing when the rule is off there.
     */
    readonly report: (problem: TreeProblem) => void;
}

/** A problem reported from `done`: the folder it is about, and the rest as `report` takes it. */
export interface TreeProblem extends Problem {
    readonly folder: string;
}

export interface RuleMeta<Options extends object> {
    /** One sentence, shown by `crowded-folders rules` and in the published schema. */
    readonly description: string;
    /** Where the rule is documented. */
    readonly url?: string;
    /** Every option, with its value when the configuration does not set it. */
    readonly defaultOptions: Options;
    /** The options, as JSON Schema: checked when the configuration loads, and offered by editors. */
    readonly options?: JsonSchema;
    /**
     * What a schema cannot say about the options as written (not merged), as messages: an `ignore`
     * entry that can never match, say. Checked when the configuration loads; any message stops it.
     */
    readonly checkOptions?: (options: Readonly<Record<string, unknown>>) => readonly OptionProblem[];
}

export interface OptionProblem {
    /** The option, as a path inside the options: `ignore[2]`. */
    readonly at: string;
    readonly message: string;
}

/** A folder, ready for a rule: its files, its subfolders and its modules. */
export interface FolderView extends FolderEntry {
    /** The files grouped into modules with the naming in effect for this folder. */
    readonly modules: readonly Module[];
    /** The naming in effect for this folder, after presets and overrides. */
    readonly naming: Naming;
    /**
     * Files of the folder that are in no module, and why: they describe the folder
     * (`package-info.java`) or go with a sibling folder (Unity's `Scripts.meta`). Still in `files`.
     */
    readonly uncounted?: readonly Uncounted[];
}

export interface RuleContext<Options extends object> {
    /** The options in effect for this folder: the defaults, then the configuration, then overrides. */
    readonly options: Options;
    readonly report: (problem: Problem) => void;
    /**
     * Something the rule looked at and chose not to report, with why: `explain` lists them, so that
     * "why is this not reported?" has an answer. Ignored by a normal run.
     */
    readonly note?: (note: Note) => void;
    /**
     * Another rule as it stands in this folder, its options merged over its defaults; `undefined`
     * when it is off or unknown. For rules that must not contradict each other: `prefix-groups` does
     * not propose a folder that `max-files` would report.
     */
    readonly settingsOf?: (
        rule: string,
    ) => { readonly severity: Severity; readonly options: Readonly<Record<string, unknown>> } | undefined;
    /**
     * The file or folder at a path (relative to the root) as the tree writes it, found without
     * regard to case or Unicode normalisation; `undefined` when nothing is there. A move must not land
     * on it: on Windows and macOS `text.ts` overwrites `Text.ts`.
     */
    readonly existing?: (path: string) => string | undefined;
}

/** What a rule did not report, and why. */
export interface Note {
    /** What it is about: a group key, a module. */
    readonly key?: string;
    readonly message: string;
}

export interface Problem {
    /** What is wrong and what to do about it, in one or two sentences. */
    readonly message: string;
    /**
     * Tells apart two problems of the same rule in the same folder — the prefix, for `prefix-groups`.
     * It is part of what a suppression remembers, so it must not change between runs.
     */
    readonly key?: string;
    /** The number that broke the limit. A suppression lets it stay, or go down, but not go up. */
    readonly measured?: number;
    readonly limit?: number;
    /** File names in the folder the problem is about, for locations in SARIF and annotations. */
    readonly files?: readonly string[];
    /** Where things could go instead. Never applied: moving files breaks imports, and that is the user's call. */
    readonly moves?: readonly Move[];
}

export interface Move {
    /** Paths relative to the root. */
    readonly from: string;
    readonly to: string;
}

/** Writes a rule with its options typed from `defaultOptions`. */
export function defineRule<Options extends object>(rule: Rule<Options>): Rule<Options> {
    return rule;
}

/** Shows a list of names, cut after `max` with how many more there are. */
export function listNames(names: readonly string[], max = 5): string {
    return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** The JSON Schema of the `hintFor` option that `max-files` and `prefix-groups` share. */
export const HINT_FOR_SCHEMA: JsonSchema = {
    type: 'array',
    items: { type: 'string', minLength: 1 },
    description:
        'Globs of file names: the hint is added only when the files the problem is about include one ("*.java", "*.{c,h}"). A hint about packages is noise on a folder of SQL. Default: always.',
};

/**
 * The hint of a preset as it ends a message (with the space before it), or nothing when `only` is
 * given and none of the files is of that kind: "A folder is a package" says nothing about the SQL,
 * templates and changelogs that sit in a Java project.
 */
export function hintText(hint: string, only: readonly string[], files: readonly string[]): string {
    if (hint === '') {
        return '';
    }
    if (only.length > 0) {
        const globs = only.map(pattern => compileGlob(pattern));
        if (files.every(file => globs.every(glob => !glob.test(file)))) {
            return '';
        }
    }
    return ` ${hint}`;
}
