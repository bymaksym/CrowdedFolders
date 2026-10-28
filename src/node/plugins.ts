import { resolve } from 'node:path';

import { isObject } from '../core/config/json-schema.ts';
import type { Plugin, Preset } from '../core/config/types.ts';
import { ConfigError } from '../core/config/validate.ts';
import { suggest } from '../core/paths/suggest.ts';
import { ruleShapeProblem } from '../core/rules/guard.ts';
import type { Rule } from '../core/rules/rule.ts';
import { isCode } from './config/file.ts';
import { compatibilityProblem, importDefault, resolveSpecifier } from './modules.ts';

const NAMESPACE = /^[a-z\d][a-z\d-]*$/u;

/**
 * What `plugins` and `extends` name: the plugins, imported and checked, and the files and packages
 * an `extends` resolves to.
 */

/** The plugins loaded so far, and what they add. */
export interface PluginRegistry {
    readonly rules: Record<string, Rule>;
    readonly presets: Record<string, Preset>;
    readonly plugins: Plugin[];
    /** Each namespace with the file it was loaded from. */
    readonly paths: Map<string, string>;
}

/** Imports a plugin named in `plugins` and adds its rules and presets, under its namespace. */
export async function loadPlugin(
    registry: PluginRegistry,
    specifier: string,
    dir: string,
    origin: string,
): Promise<void> {
    let path: string;
    let value: unknown;
    try {
        path = resolveSpecifier(specifier, dir);
        value = await importDefault(path);
    } catch (error) {
        throw new ConfigError(origin, [
            { at: 'plugins', message: `"${specifier}" cannot be loaded: ${(error as Error).message}` },
        ]);
    }
    const problem = pluginProblem(value);
    if (problem) {
        throw new ConfigError(origin, [
            { at: 'plugins', message: `"${specifier}" is not a crowded-folders plugin: ${problem}` },
        ]);
    }
    // Before any of its rules runs: a plugin made for another major version would break halfway.
    const incompatible = compatibilityProblem(specifier, path);
    if (incompatible) {
        throw new ConfigError(origin, [{ at: 'plugins', message: incompatible }]);
    }
    const plugin = value as Plugin;
    const namespace = plugin.meta.namespace;
    const previous = registry.paths.get(namespace);
    if (previous === resolve(path)) {
        return;
    }
    if (previous !== undefined) {
        throw new ConfigError(origin, [
            { at: 'plugins', message: `two plugins use the namespace "${namespace}": ${previous} and ${path}` },
        ]);
    }
    registry.paths.set(namespace, resolve(path));
    registry.plugins.push(plugin);
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
        registry.rules[`${namespace}/${name}`] = rule;
    }
    for (const [name, preset] of Object.entries(plugin.presets ?? {})) {
        registry.presets[`${namespace}/${name}`] = preset;
    }
}

/** What is wrong with a value that should be a plugin, or `undefined` if it is one. */
export function pluginProblem(value: unknown): string | undefined {
    if (!isObject(value) || !isObject(value['meta'])) {
        return 'its default export needs a "meta" object';
    }
    const meta = value['meta'];
    if (typeof meta['namespace'] !== 'string' || !NAMESPACE.test(meta['namespace'])) {
        return 'meta.namespace must be lowercase letters, digits and "-"';
    }
    if (typeof meta['name'] !== 'string') {
        return 'meta.name must be its package name';
    }
    const rules = value['rules'];
    if (rules !== undefined) {
        if (!isObject(rules)) {
            return '"rules" must be an object';
        }
        for (const [name, rule] of Object.entries(rules)) {
            const problem = ruleShapeProblem(rule);
            if (problem !== undefined) {
                return `rule "${name}" ${problem}`;
            }
        }
    }
    const presets = value['presets'];
    if (presets !== undefined) {
        if (!isObject(presets)) {
            return '"presets" must be an object';
        }
        for (const [name, preset] of Object.entries(presets)) {
            if (
                !isObject(preset) ||
                !isObject(preset['config']) ||
                typeof preset['description'] !== 'string' ||
                !Array.isArray(preset['sources'])
            ) {
                return `preset "${name}" needs "description", "sources" and "config"`;
            }
        }
    }
    return undefined;
}

/**
 * The file or package an `extends` entry names. A plain name (no `/`, `@` or `.`) close to a
 * preset is a misspelled preset, never a package to install: "install recomended" is how a
 * typosquatted package gets in.
 */
export function resolveExtends(
    registry: PluginRegistry & { readonly code: boolean },
    entry: string,
    dir: string,
    origin: string,
): string {
    const known = Object.keys(registry.presets).join(', ');
    const isPlainName = !/[/@.\\]/u.test(entry);
    const meant = didYouMean(entry, registry.presets);
    if (isPlainName && meant !== '') {
        throw new ConfigError(origin, [
            { at: 'extends', message: `"${entry}" is not a preset${meant} (known: ${known})` },
        ]);
    }
    if (/^[a-z\d-]+\/[^/]+$/u.test(entry) && !entry.startsWith('.')) {
        const namespace = entry.slice(0, entry.indexOf('/'));
        if (registry.plugins.some(plugin => plugin.meta.namespace === namespace)) {
            throw new ConfigError(origin, [
                { at: 'extends', message: `"${entry}": the plugin "${namespace}" has no such preset` },
            ]);
        }
    }
    let path: string;
    try {
        path = resolveSpecifier(entry, dir);
    } catch (error) {
        throw new ConfigError(origin, [
            {
                at: 'extends',
                message: isPlainName
                    ? `"${entry}" is not a preset (known: ${known}), nor a package installed where the configuration is (from ${dir})`
                    : `"${entry}" is not a preset (known: ${known}) and cannot be loaded: ${(error as Error).message}`,
            },
        ]);
    }
    if (!registry.code && isCode(path)) {
        throw new ConfigError(origin, [
            {
                at: 'extends',
                message: `"${entry}" is ${path}, JavaScript, and --no-code reads only JSON configurations`,
            },
        ]);
    }
    return path;
}

/** `; did you mean "recommended"?` for a name close to a preset, else empty. */
export function didYouMean(entry: string, presets: Readonly<Record<string, Preset>>): string {
    const meant = suggest(entry, Object.keys(presets));
    return meant === undefined ? '' : `; did you mean "${meant}"?`;
}
