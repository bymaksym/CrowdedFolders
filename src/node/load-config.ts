import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { isObject } from '../core/config/json-schema.ts';
import { mergeLayer, mergeList, overrideState } from '../core/config/merge.ts';
import { fromFolderAbove, globUnder, type Scope, scopeOf, tighteningLast } from '../core/config/scope.ts';
import {
    type Config,
    EMPTY_CONFIG,
    type OverrideState,
    type Plugin,
    type Preset,
    type ResolvedConfig,
    type RuleSetting,
} from '../core/config/types.ts';
import { ConfigError, validateConfig } from '../core/config/validate.ts';
import { selectFiles } from '../core/engine.ts';
import { BUILT_IN_PRESETS } from '../core/presets/index.ts';
import { BUILT_IN_RULES } from '../core/rules/index.ts';
import type { Rule } from '../core/rules/rule.ts';
import { isCode, type NestedConfig, projectDirOf, readConfigFile } from './config-file.ts';
import { didYouMean, loadPlugin, resolveExtends } from './plugins.ts';

export { ConfigError } from '../core/config/validate.ts';
export type { NestedConfig } from './config-file.ts';
export { pluginProblem } from './plugins.ts';

export interface LoadedConfig {
    readonly config: ResolvedConfig;
    /** Built-in rules and the rules of every plugin, by the name a configuration uses. */
    readonly rules: Readonly<Record<string, Rule>>;
    /** Built-in presets and the presets of every plugin. */
    readonly presets: Readonly<Record<string, Preset>>;
    readonly plugins: readonly Plugin[];
    /** What in the configuration does nothing and is worth saying: a `"!x"` that removes nothing. */
    readonly warnings: readonly string[];
    /** The `include` and `exclude` of the configuration itself (not what it extends), to say which match no file. */
    readonly own: { readonly origin: string; readonly include: readonly string[]; readonly exclude: readonly string[] };
}

export interface LoadOptions {
    /** `false` (`--no-code`): only JSON is read; a JavaScript configuration, package or plugin is an error. */
    readonly code?: boolean;
    /**
     * The folder the run's paths start at. Default: the configuration's folder. A file extended from a
     * folder above it (a shared `base.json` at the top of a monorepo) has its globs read from its folder.
     */
    readonly base?: string;
    /** Package configurations below the base, the deepest last. */
    readonly nested?: readonly NestedConfig[];
}

/**
 * Applies a configuration and everything it extends, in order, and loads its plugins.
 *
 * `extends` entries are applied depth first, each at most once: `["react", "strict"]` applies
 * `recommended` (which both extend) once, then `react`, then `strict`. A preset that tightens the
 * others (`strict`) goes after the rest of its list, wherever it is written. A cycle is an error.
 */
export async function loadConfig(
    raw: unknown,
    origin: string,
    dir: string,
    extraRules: Readonly<Record<string, Rule>> = {},
    options: LoadOptions = {},
): Promise<LoadedConfig> {
    const loader = new Loader(extraRules, options, options.base ?? dir);
    await loader.applyLayer(raw, origin, dir, { own: true, chain: [], kind: 'config' });
    await loader.applyNested(options.nested ?? []);
    const own = raw as Config;
    return {
        config: loader.state,
        rules: loader.rules,
        presets: loader.presets,
        plugins: loader.plugins,
        warnings: loader.warnings,
        own: { origin, include: own.include ?? [], exclude: own.exclude ?? [] },
    };
}

/** Reads and applies a configuration file. */
export async function loadConfigFile(
    path: string,
    extraRules: Readonly<Record<string, Rule>> = {},
    options: LoadOptions = {},
): Promise<LoadedConfig> {
    if (options.code === false && isCode(path)) {
        throw new ConfigError(path, [
            {
                at: '(the configuration)',
                message:
                    'is JavaScript, and --no-code reads only JSON: the configuration would run as code. Use a crowded-folders.config.json, or drop --no-code for a repository you trust.',
            },
        ]);
    }
    return loadConfig(await readConfigFile(path), path, dirname(path), extraRules, {
        ...options,
        base: options.base ?? projectDirOf(path),
    });
}

interface LayerContext {
    readonly own: boolean;
    readonly chain: readonly string[];
    readonly kind: 'config' | 'file' | 'preset';
    /** The preset's name, for a preset. */
    readonly preset?: string;
}

class Loader {
    state: ResolvedConfig = EMPTY_CONFIG;
    rules: Record<string, Rule>;
    presets: Record<string, Preset> = { ...BUILT_IN_PRESETS };
    plugins: Plugin[] = [];
    warnings: string[] = [];
    private readonly applied = new Set<string>();
    readonly paths = new Map<string, string>();
    /** Rules a preset applied so far keeps from a preset that tightens, with which preset. */
    private readonly kept = new Map<string, string>();
    /** The presets that tighten, applied to the whole tree: applied again in each scope. */
    private readonly tighteners: string[] = [];
    readonly code: boolean;
    private readonly base: string;

    /** Extra rules, as `lint({ rules })` passes them: known before the configuration is checked. */
    constructor(extraRules: Readonly<Record<string, Rule>>, options: LoadOptions, base: string) {
        this.rules = { ...BUILT_IN_RULES, ...extraRules };
        this.code = options.code !== false;
        this.base = resolve(base);
    }

    async applyLayer(raw: unknown, origin: string, dir: string, context: LayerContext): Promise<void> {
        const config = await this.checked(raw, origin, dir);
        const { layer, own } =
            context.kind === 'file' ? this.fromItsFolder(config, origin) : { layer: config, own: context.own };
        await this.applyExtendsList(layer.extends ?? [], dir, origin, context);
        this.warnNegations(layer, origin);
        const preset = context.preset === undefined ? undefined : this.presets[context.preset];
        const rules = preset?.tightens ? this.withoutKept(layer.rules, this.kept) : layer.rules;
        this.state = mergeLayer(this.state, { ...layer, ...(rules && { rules }), overrides: [] }, origin, own);
        for (const [name, why] of Object.entries(preset?.keeps ?? {})) {
            this.kept.set(name, `${origin}: ${why}`);
        }
        if (preset?.tightens && context.preset !== undefined) {
            this.tighteners.push(context.preset);
        }
        for (const override of layer.overrides ?? []) {
            if (override.extends && override.extends.length > 0) {
                await this.applyScoped(
                    { extends: override.extends },
                    origin,
                    dir,
                    scopeOf(override.folders, override.withFiles ?? [], override.reason, false),
                    context.chain,
                    false,
                );
            }
            this.pushOverrides([overrideState(override, origin, own)]);
        }
    }

    /** The package configurations below the base: applied to their folder with `"root": false`, else said not to be read. */
    async applyNested(nested: readonly NestedConfig[]): Promise<void> {
        for (const { path, folder } of nested) {
            // One in a folder the configuration leaves out (test fixtures, an example) is not the repository's.
            if (selectFiles([relative(this.base, path).split(sep).join('/')], this.state).length === 0) {
                continue;
            }
            if (!this.code && isCode(path)) {
                this.warnings.push(
                    `${path} is JavaScript and --no-code reads only JSON: it is not applied to ${folder}.`,
                );
                continue;
            }
            const raw = await readConfigFile(path);
            if (!isObject(raw) || raw['root'] !== false) {
                this.warnings.push(
                    `${path} is not read when checking from ${this.base}: its folder ${folder} is checked with this configuration. Add "root": false to it to apply it to ${folder} from here (and to use this configuration when checking from ${folder}), or check from ${folder}.`,
                );
                continue;
            }
            const refused = ['plugins', 'include', 'suppressions'].filter(key => raw[key] !== undefined);
            if (refused.length > 0) {
                throw new ConfigError(
                    path,
                    refused.map(key => ({
                        at: key,
                        message: `a package configuration ("root": false) cannot set ${key}: set it in the configuration at the top`,
                    })),
                );
            }
            const config = await this.checked(raw, path, dirname(path));
            const scope = scopeOf(
                [`${folder}/**`],
                [],
                `the configuration of ${folder} (${relative(this.base, path).replaceAll('\\', '/')})`,
                true,
            );
            await this.applyScoped(config, path, dirname(path), scope, [path], true);
        }
    }

    /**
     * Applies a layer to some folders only: its rules and naming become an override for them, its
     * overrides are read from their folder and apply only inside them, and its excludes start there.
     */
    private async applyScoped(
        config: Config,
        origin: string,
        dir: string,
        scope: Scope,
        chain: readonly string[],
        own: boolean,
        isOutermost = true,
    ): Promise<void> {
        for (const entry of tighteningLast(config.extends ?? [], this.presets)) {
            const preset = this.presets[entry];
            if (preset) {
                if (this.applied.has(entry) || scope.applied.has(entry)) {
                    continue;
                }
                scope.applied.add(entry);
                const presetConfig = await this.checked(preset.config, `preset "${entry}"`, dir);
                const tightened = preset.tightens ? this.withoutKept(presetConfig.rules, scope.kept) : undefined;
                await this.applyScoped(
                    tightened ? { ...presetConfig, rules: tightened } : presetConfig,
                    `preset "${entry}"`,
                    dir,
                    scope,
                    chain,
                    false,
                    false,
                );
                for (const [name, why] of Object.entries(preset.keeps ?? {})) {
                    scope.kept.set(name, `preset "${entry}": ${why}`);
                }
                continue;
            }
            if (!scope.allowsFiles) {
                throw new ConfigError(origin, [
                    {
                        at: 'overrides[].extends',
                        message: `"${entry}" is not a preset${didYouMean(entry, this.presets)}: an override extends presets only (known: ${Object.keys(this.presets).join(', ')}); a file or package applies to the whole configuration, in "extends"`,
                    },
                ]);
            }
            const path = resolveExtends(this, entry, dir, origin);
            if (chain.includes(path)) {
                throw new ConfigError(origin, [
                    { at: 'extends', message: `"${entry}" extends itself through ${[...chain, path].join(' → ')}` },
                ]);
            }
            if (scope.applied.has(path)) {
                continue;
            }
            scope.applied.add(path);
            const extended = await this.checked(await readConfigFile(path), path, dirname(path));
            await this.applyScoped(extended, path, dirname(path), scope, [...chain, path], false, false);
        }

        // A preset that tightens the whole tree tightens what these folders extend, before their own settings.
        if (isOutermost && scope.applied.size > 0) {
            for (const name of this.tighteners) {
                const rules = this.withoutKept(this.presets[name]?.config.rules, scope.kept);
                if (rules && Object.keys(rules).length > 0) {
                    this.pushOverrides([
                        {
                            ...overrideState(
                                { folders: scope.folders, withFiles: scope.withFiles, reason: scope.reason },
                                `preset "${name}"`,
                                false,
                            ),
                            rules,
                        },
                    ]);
                }
            }
        }

        const exclude: string[] = [];
        for (const pattern of config.exclude ?? []) {
            if (pattern.startsWith('!')) {
                this.warnings.push(
                    `${origin}: "${pattern}" in exclude is not applied to ${scope.folders.join(', ')}: "!" takes out an entry of the whole configuration, and cannot do it for some folders only.`,
                );
                continue;
            }
            exclude.push(...scope.bases.map(base => globUnder(base, pattern)));
        }
        const states: OverrideState[] = [];
        if (Object.keys(config.rules ?? {}).length > 0 || config.naming) {
            states.push({
                ...overrideState(
                    { folders: scope.folders, withFiles: scope.withFiles, reason: scope.reason },
                    origin,
                    false,
                ),
                rules: config.rules ?? {},
                naming: config.naming ?? {},
            });
        }
        for (const inner of config.overrides ?? []) {
            const folders = [...new Set(inner.folders.flatMap(glob => scope.bases.map(base => globUnder(base, glob))))];
            if (inner.extends && inner.extends.length > 0) {
                this.pushOverrides(states.splice(0));
                await this.applyScoped(
                    { extends: inner.extends },
                    origin,
                    dir,
                    {
                        ...scopeOf(folders, inner.withFiles ?? [], inner.reason, false),
                        applied: new Set(scope.applied),
                    },
                    chain,
                    false,
                    false,
                );
            }
            states.push({ ...overrideState({ ...inner, folders }, origin, own), within: scope.folders });
        }
        this.state = { ...this.state, exclude: mergeList(this.state.exclude, exclude) };
        this.pushOverrides(states);
    }

    /** A layer read whole before any of its code runs: checked, then its plugins loaded, then checked again. */
    private async checked(raw: unknown, origin: string, dir: string): Promise<Config> {
        if (!isObject(raw)) {
            throw new ConfigError(origin, [
                {
                    at: '(the configuration)',
                    message: `must be an object, not ${raw === undefined ? 'empty' : typeof raw}`,
                },
            ]);
        }
        const presetNames = Object.keys(BUILT_IN_PRESETS);
        const plugins = (raw as Config).plugins ?? [];
        const early = validateConfig(raw, this.rules, presetNames, { pluginsPending: plugins.length > 0 });
        if (early.length > 0) {
            throw new ConfigError(origin, early);
        }
        if (plugins.length > 0 && !this.code) {
            throw new ConfigError(origin, [
                {
                    at: 'plugins',
                    message: `${plugins.map(plugin => `"${plugin}"`).join(', ')}: a plugin is code, and --no-code reads only JSON. Drop --no-code for a repository you trust.`,
                },
            ]);
        }
        for (const specifier of plugins) {
            await loadPlugin(this, specifier, dir, origin);
        }
        if (plugins.length > 0) {
            const problems = validateConfig(raw, this.rules, presetNames);
            if (problems.length > 0) {
                throw new ConfigError(origin, problems);
            }
        }
        return raw;
    }

    /**
     * A file extended from a folder above the base (a shared `base.json` at the top of a monorepo,
     * extended from a package) wrote its globs from its own folder: they are read from there, and
     * what can only match outside the base is dropped. A file in the base or below it, in the
     * repository, is the user's own: its overrides that match nothing are reported.
     */
    private fromItsFolder(config: Config, path: string): { layer: Config; own: boolean } {
        const declared = resolve(projectDirOf(path));
        const fromDeclared = relative(declared, this.base);
        const isInRepository = !path.split(sep).includes('node_modules') && !path.split('/').includes('node_modules');
        if (fromDeclared === '' || fromDeclared.startsWith('..') || isAbsolute(fromDeclared)) {
            const inside = relative(this.base, declared);
            const isInBase = inside === '' || (!inside.startsWith('..') && !isAbsolute(inside));
            return { layer: config, own: isInRepository && isInBase };
        }
        const below = fromDeclared.split(sep).join('/');
        return { layer: fromFolderAbove(config, below), own: false };
    }

    private async applyExtendsList(
        entries: readonly string[],
        dir: string,
        origin: string,
        context: LayerContext,
    ): Promise<void> {
        const before = new Set(this.applied);
        const chain = [...context.chain, origin];
        for (const entry of tighteningLast(entries, this.presets)) {
            const preset = this.presets[entry];
            if (preset) {
                if (this.applied.has(entry)) {
                    if (!before.has(entry) && context.kind !== 'preset') {
                        this.warnings.push(
                            `${origin}: "${entry}" in extends was already applied by an entry before it, which extends it, so it does nothing here. Each preset is applied once, where it is first reached: "later ones win" does not apply it again. Put it first, or remove it.`,
                        );
                    }
                    continue;
                }
                this.applied.add(entry);
                await this.applyLayer(preset.config, `preset "${entry}"`, dir, {
                    own: false,
                    chain,
                    kind: 'preset',
                    preset: entry,
                });
                continue;
            }
            const path = resolveExtends(this, entry, dir, origin);
            if (chain.includes(path)) {
                throw new ConfigError(origin, [
                    { at: 'extends', message: `"${entry}" extends itself through ${[...chain, path].join(' → ')}` },
                ]);
            }
            if (this.applied.has(path)) {
                continue;
            }
            this.applied.add(path);
            await this.applyLayer(await readConfigFile(path), path, dirname(path), { own: false, chain, kind: 'file' });
        }
    }

    /** The rules of a preset that tightens, without the ones a preset applied so far keeps. */
    private withoutKept(
        rules: Readonly<Record<string, RuleSetting>> | undefined,
        kept: ReadonlyMap<string, string>,
    ): Readonly<Record<string, RuleSetting>> | undefined {
        return rules
            ? Object.fromEntries(Object.entries(rules).filter(([name]) => !this.kept.has(name) && !kept.has(name)))
            : rules;
    }

    private pushOverrides(states: readonly OverrideState[]): void {
        if (states.length > 0) {
            this.state = { ...this.state, overrides: [...this.state.overrides, ...states] };
        }
    }

    /**
     * `"!x"` removes `x` from what was inherited. In `exclude` it looks like a gitignore negation
     * that brings files back, and it is not one: when there is no `x` to remove, it does nothing, so say so.
     */
    private warnNegations(config: Config, origin: string): void {
        for (const key of ['include', 'exclude'] as const) {
            for (const entry of config[key] ?? []) {
                if (entry.startsWith('!') && !this.state[key].includes(entry.slice(1))) {
                    this.warnings.push(
                        `${origin}: "${entry}" in ${key} removes nothing: "!" only takes out an entry inherited from a preset or an extended file, written the same way. It is not a gitignore negation and brings no file back.`,
                    );
                }
            }
        }
    }
}
