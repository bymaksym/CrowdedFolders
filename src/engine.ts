/**
 * `crowded-folders/engine`: the analysis without Node. Nothing here, nor anything it imports, reads a
 * file, runs git or touches `process` (ESLint enforces it), so it bundles for a browser or a worker.
 * It is also everything `crowded-folders` exports that is not about the disk.
 */
import type { Config, Plugin, Preset } from './core/config/types.ts';
import { type Detection, detectPresets as detectFromFiles } from './core/presets/detect.ts';
import { BUILT_IN_PRESETS } from './core/presets/index.ts';

export { mergeLayer } from './core/config/merge.ts';
export { type Resolution, resolveConfig, type ResolveOptions } from './core/config/resolve.ts';
export { configSchema } from './core/config/schema.ts';
export type {
    Config,
    Detect,
    NamingConfig,
    OverrideConfig,
    Plugin,
    Preset,
    ResolvedConfig,
    RuleSetting,
    Source,
} from './core/config/types.ts';
export { ConfigError, type ConfigProblem } from './core/config/validate.ts';
export { type EngineInput, type EngineResult, explainFolder, type Finding, runEngine } from './core/engine.ts';
export { groupKeyOf, type Module, modulesOf, type Naming, stemOf } from './core/naming/modules.ts';
export { splitWords } from './core/naming/words.ts';
export { FileListError, type PathProblem } from './core/paths/input.ts';
export type { Detection } from './core/presets/detect.ts';
export { BUILT_IN_PRESETS } from './core/presets/index.ts';
export { RuleError } from './core/rules/guard.ts';
export { BUILT_IN_RULES } from './core/rules/index.ts';
export {
    defineRule,
    type FolderView,
    type Move,
    type Problem,
    type Rule,
    type RuleContext,
    type RuleMeta,
    type RuleVisitor,
    type Severity,
    type TreeContext,
    type TreeProblem,
} from './core/rules/rule.ts';

/** Types a configuration file written in JavaScript: `export default defineConfig({ … })`. */
export function defineConfig(config: Config): Config {
    return config;
}

/** Types a plugin: `export default definePlugin({ meta, rules, presets })`. */
export function definePlugin(plugin: Plugin): Plugin {
    return plugin;
}

/** Types a preset, for plugins and shared configurations. */
export function definePreset(preset: Preset): Preset {
    return preset;
}

export interface DetectOptions {
    /**
     * The dependencies the repository's package.json files declare: names, or each name with the
     * package.json files (relative to the root) that declare it, which tells where a preset applies.
     */
    readonly dependencies?: Iterable<string> | ReadonlyMap<string, readonly string[]>;
    /** The presets to choose from. Default: the built-in ones. */
    readonly presets?: Readonly<Record<string, Preset>>;
}

/**
 * Which presets fit a repository, from its file paths and its dependencies: what the command and
 * `lint()` use when there is no configuration, and what `init` writes. `recommended` comes first.
 */
export function detectPresets(files: readonly string[], options: DetectOptions = {}): Detection[] {
    const given = options.dependencies ?? [];
    const dependencies =
        given instanceof Map
            ? (given as ReadonlyMap<string, readonly string[]>)
            : new Map([...(given as Iterable<string>)].map(name => [name, ['package.json']] as const));
    return detectFromFiles(files, dependencies, options.presets ?? BUILT_IN_PRESETS);
}
