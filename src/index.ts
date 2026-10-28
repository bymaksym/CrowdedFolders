/**
 * The programmatic API: what a plugin, a shared configuration or a script imports.
 *
 * Everything exported here is public and versioned; anything else under `dist/` is not importable
 * (package.json `exports` closes it).
 */
import { resolve } from 'node:path';

import type { Config, Plugin, Preset } from './core/config/types.ts';
import { type EngineResult, runEngine } from './core/engine.ts';
import { FileListError, normaliseFileList } from './core/paths/input.ts';
import type { Rule } from './core/rules/rule.ts';
import { locate } from './node/config-file.ts';
import { listFiles } from './node/files.ts';
import { loadConfig, loadConfigFile } from './node/load-config.ts';

export { mergeLayer } from './core/config/merge.ts';
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
export { explainFolder, type Finding, runEngine } from './core/engine.ts';
export { groupKeyOf, type Module, modulesOf, type Naming, stemOf } from './core/naming/modules.ts';
export { splitWords } from './core/naming/words.ts';
export { FileListError, type PathProblem } from './core/paths/input.ts';
export { BUILT_IN_PRESETS } from './core/presets/index.ts';
export { BUILT_IN_RULES } from './core/rules/index.ts';
export {
    defineRule,
    type FolderView,
    type Move,
    type Problem,
    type Rule,
    type RuleContext,
    type RuleMeta,
    type Severity,
} from './core/rules/rule.ts';
export { GitError } from './node/files.ts';
export { ConfigError } from './node/load-config.ts';

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

export interface LintOptions {
    /** Where relative paths start, and where to look for the configuration without `root`. Default: `process.cwd()`. */
    readonly cwd?: string;
    /** A configuration object, or the path of a configuration file. Default: found from `root`, else from `cwd`, upwards. */
    readonly config?: Config | string;
    /** The folder to check. Default: the configuration's folder, else the top of the git repository, else `cwd`. */
    readonly root?: string;
    /**
     * The files to check, relative to the root (`./a.ts` and `a\b.ts` are read as the command reads
     * them; an absolute path under the root is made relative to it). A path outside the root throws a
     * `FileListError`. Default: asked to git, or read from the disk outside a repository.
     */
    readonly files?: readonly string[];
    /** Extra rules, as a plugin would add them, by full name. */
    readonly rules?: Readonly<Record<string, Rule>>;
}

export interface LintResult extends EngineResult {
    readonly root: string;
}

/**
 * Checks a repository the way the command does, and returns the findings without printing them.
 * When the root is inside the configuration's folder, the configuration's patterns are read from its
 * folder, as the command reads them, and so are the folders of the findings.
 */
export async function lint(options: LintOptions = {}): Promise<LintResult> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const configObject = typeof options.config === 'object' ? options.config : undefined;
    const given = typeof options.config === 'string' ? resolve(cwd, options.config) : undefined;
    const located = locate({
        cwd,
        configPath: given,
        root: options.root === undefined ? undefined : resolve(cwd, options.root),
    });
    const configPath = configObject === undefined ? located.configPath : undefined;
    const { root, base, scope } = configPath === undefined ? { ...located, base: located.root, scope: '.' } : located;
    const loaded =
        configPath === undefined
            ? await loadConfig(
                  configObject ?? { extends: ['recommended'] },
                  '(the lint() options)',
                  root,
                  options.rules,
              )
            : await loadConfigFile(configPath, options.rules);
    let files: readonly string[];
    if (options.files === undefined) {
        files = listFiles(root, { git: true }).files;
    } else {
        const read = normaliseFileList(options.files, root);
        if (read.problems.length > 0) {
            throw new FileListError(read.problems);
        }
        files = read.files;
    }
    const result = runEngine({
        files: scope === '.' ? files : files.map(file => `${scope}/${file}`),
        config: loaded.config,
        rules: loaded.rules,
        ...(scope !== '.' && { only: [scope] }),
    });
    return { ...result, root: scope === '.' ? root : base };
}
