import { applySetting, mergeNaming } from './config/merge.ts';
import type { NamingState, OverrideState, ResolvedConfig, RuleState } from './config/types.ts';
import type { Naming } from './naming/modules.ts';
import { type CompiledOverride, OverrideIndex } from './overrides.ts';
import { compileGlob } from './paths/glob.ts';
import { parseMirrors } from './paths/mirrors.ts';
import type { FolderEntry } from './paths/tree.ts';
import { ReadOnlySet } from './rules/guard.ts';

/** What applies in a folder: shared, frozen, by every folder the same overrides match. */
export interface Settings {
    readonly naming: NamingState;
    readonly rules: Readonly<Record<string, RuleState>>;
    readonly overrides: readonly OverrideState[];
    /** The rules that are on, in the order of `rules`. */
    readonly active: readonly (readonly [string, RuleState])[];
    /** Whether every rule that is on is a built-in one, which changes nothing it is given. */
    readonly onlyBuiltIn: boolean;
}

/**
 * The settings of each folder: the configuration, then each override that matches it, in order.
 * Folders matched by the same overrides share one result, frozen: its rule states are then the same
 * objects from folder to folder, so what is made from them (the options merged over a rule's
 * defaults and frozen, the compiled naming) is made once per set of overrides, not once per folder.
 * In a monorepo with an override per package that is the difference between 400 and 400 000.
 */
export class FolderSettings {
    /** The configuration's overrides, compiled; `used` is set as folders match them. */
    readonly overrides: readonly CompiledOverride[];
    private readonly config: ResolvedConfig;
    private readonly isBuiltIn: (rule: string) => boolean;
    private readonly index: OverrideIndex;
    /** The position of each override, which names a set of them in `cache`. */
    private readonly ids = new Map<CompiledOverride, number>();
    /** The settings of each set of matched overrides, by their positions: `"3,17"`. */
    private readonly cache = new Map<string, Settings>();
    private readonly namingById = new Map<string, Naming>();
    /** The naming compiled for each naming state: states are shared, so most folders find it here. */
    private readonly namingByState = new WeakMap<NamingState, Naming>();

    constructor(config: ResolvedConfig, isBuiltIn: (rule: string) => boolean) {
        this.config = config;
        this.isBuiltIn = isBuiltIn;
        this.overrides = config.overrides.map(state => ({
            state,
            globs: state.folders.map(compileGlob),
            withFiles: state.withFiles.map(compileGlob),
            within: state.within.map(compileGlob),
            used: false,
        }));
        this.index = new OverrideIndex(this.overrides);
        for (const [index, override] of this.overrides.entries()) {
            this.ids.set(override, index);
        }
    }

    settingsFor(entry: Pick<FolderEntry, 'files' | 'path'>): Settings {
        const matched: CompiledOverride[] = [];
        for (const override of this.index.candidatesFor(entry.path)) {
            if (
                override.globs.every(glob => !glob.test(entry.path)) ||
                (override.within.length > 0 && override.within.every(glob => !glob.test(entry.path))) ||
                (override.withFiles.length > 0 &&
                    entry.files.every(file => override.withFiles.every(glob => !glob.test(file))))
            ) {
                continue;
            }
            override.used = true;
            matched.push(override);
        }
        const id = matched.map(override => this.ids.get(override)).join(',');
        const cached = this.cache.get(id);
        if (cached) {
            return cached;
        }
        let naming = this.config.naming;
        const rules: Record<string, RuleState> = { ...this.config.rules };
        for (const { state } of matched) {
            naming = mergeNaming(naming, state.naming);
            for (const [name, setting] of Object.entries(state.rules)) {
                rules[name] = applySetting(rules[name], setting);
            }
        }
        const active = Object.entries(rules).filter(([, state]) => state.severity !== 'off');
        const settings: Settings = Object.freeze({
            naming,
            rules: Object.freeze(rules),
            overrides: Object.freeze(matched.map(override => override.state)),
            active: Object.freeze(active),
            onlyBuiltIn: active.every(([name]) => this.isBuiltIn(name)),
        });
        this.cache.set(id, settings);
        return settings;
    }

    /** A naming state compiled for the rules: its patterns made, frozen, shared by every folder that has it. */
    namingOf(state: NamingState): Naming {
        const shared = this.namingByState.get(state);
        if (shared) {
            return shared;
        }
        const id = JSON.stringify(state);
        const naming = this.namingById.get(id) ?? compileNaming(state);
        this.namingById.set(id, naming);
        this.namingByState.set(state, naming);
        return naming;
    }
}

function compileNaming(state: NamingState): Naming {
    // Frozen: every folder with the same naming shares this object.
    return Object.freeze({
        companions: Object.freeze(state.companions.map(pattern => new RegExp(pattern, 'u'))),
        ignoreLeadingWords: new ReadOnlySet(state.ignoreLeadingWords),
        groupNumericPrefixes: state.groupNumericPrefixes,
        folderFiles: Object.freeze(state.folderFiles.map(glob => Object.freeze(compileGlob(glob)))),
        folderCompanions: Object.freeze([...state.folderCompanions]),
        folderCase: state.folderCase,
        reservedWords: new ReadOnlySet(state.reservedWords),
        keepInPlace: Object.freeze(state.keepInPlace.map(glob => Object.freeze(compileGlob(glob)))),
        routes: state.routes,
        groupFileStays: state.groupFileStays,
        mirrors: Object.freeze(parseMirrors(state.mirrors)),
    });
}
