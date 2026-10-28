import { BUILT_IN_PRESETS } from '../presets/index.ts';
import { ruleShapeProblem } from '../rules/guard.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import type { Rule } from '../rules/rule.ts';
import { isObject } from './json-schema.ts';
import { mergeLayer } from './merge.ts';
import { type Config, EMPTY_CONFIG, type Plugin, type Preset, type ResolvedConfig } from './types.ts';
import { ConfigError, validateConfig } from './validate.ts';

export interface ResolveOptions {
    /**
     * Plugins, as objects: their rules and presets can be named (`acme/rule`, `acme/preset`), and a
     * `plugins` entry of the configuration that is one of their `meta.name` is taken as loaded.
     */
    readonly plugins?: readonly Plugin[];
    /** More rules, by the full name the configuration uses. */
    readonly rules?: Readonly<Record<string, Rule>>;
    /** More presets, by the name `extends` uses. */
    readonly presets?: Readonly<Record<string, Preset>>;
    /** What messages call the configuration. Default: `(the configuration)`. */
    readonly origin?: string;
}

/** A configuration ready for `runEngine`: spread it in (`runEngine({ files, ...resolveConfig(config) })`). */
export interface Resolution {
    readonly config: ResolvedConfig;
    /** Every rule that can be named: built-in, from the plugins and given. */
    readonly rules: Readonly<Record<string, Rule>>;
    /** Every preset that can be named. */
    readonly presets: Readonly<Record<string, Preset>>;
}

/**
 * Applies a configuration and the presets it extends, in order, and checks it, as loading a file
 * does — without reading anything. For a browser, a worker or a test with a configuration written
 * by hand: `extends` names presets only (built-in, given or from the given plugins), and plugins
 * are passed as objects. A wrong configuration throws a `ConfigError`, as `lint()` does.
 *
 * A configuration with no `extends` gets no preset: `{ rules: { "max-files": "error" } }` is that
 * rule and nothing else.
 */
export function resolveConfig(config: Config, options: ResolveOptions = {}): Resolution {
    const origin = options.origin ?? '(the configuration)';
    const rules: Record<string, Rule> = { ...BUILT_IN_RULES, ...options.rules };
    const presets: Record<string, Preset> = { ...BUILT_IN_PRESETS, ...options.presets };
    const loaded = new Set<string>();
    for (const plugin of options.plugins ?? []) {
        loaded.add(plugin.meta.name);
        for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
            rules[`${plugin.meta.namespace}/${name}`] = rule;
        }
        for (const [name, preset] of Object.entries(plugin.presets ?? {})) {
            presets[`${plugin.meta.namespace}/${name}`] = preset;
        }
    }
    for (const [name, rule] of Object.entries(rules)) {
        const problem = ruleShapeProblem(rule);
        if (problem !== undefined) {
            throw new ConfigError(origin, [{ at: `rules[${JSON.stringify(name)}]`, message: `the rule ${problem}` }]);
        }
    }

    let state = EMPTY_CONFIG;
    const applied = new Set<string>();
    const apply = (raw: unknown, layerOrigin: string, own: boolean, chain: readonly string[]): void => {
        if (!isObject(raw)) {
            throw new ConfigError(layerOrigin, [{ at: '(the configuration)', message: 'must be an object' }]);
        }
        const problems = validateConfig(raw, rules, Object.keys(presets));
        const layer = raw as Config;
        for (const specifier of layer.plugins ?? []) {
            if (!loaded.has(specifier)) {
                problems.push({
                    at: 'plugins',
                    message: `"${specifier}" is not among the plugins given: resolveConfig loads nothing, so pass the plugin object in options.plugins`,
                });
            }
        }
        for (const entry of layer.extends ?? []) {
            if (presets[entry] === undefined) {
                problems.push({
                    at: 'extends',
                    message: `"${entry}" is not a preset (known: ${Object.keys(presets).join(', ')}); resolveConfig reads no files, so a file or package is lint()'s job`,
                });
            }
        }
        if (problems.length > 0) {
            throw new ConfigError(layerOrigin, problems);
        }
        for (const entry of layer.extends ?? []) {
            if (chain.includes(entry)) {
                throw new ConfigError(layerOrigin, [
                    { at: 'extends', message: `"${entry}" extends itself through ${[...chain, entry].join(' → ')}` },
                ]);
            }
            if (applied.has(entry)) {
                continue;
            }

            applied.add(entry);
            apply(presets[entry]?.config, `preset "${entry}"`, false, [...chain, entry]);
        }
        state = mergeLayer(state, layer, layerOrigin, own);
    };
    apply(config, origin, true, []);
    return { config: state, rules, presets };
}
