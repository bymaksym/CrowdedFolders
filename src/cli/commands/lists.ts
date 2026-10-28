import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Plugin, Preset } from '../../core/config/types.ts';
import { explainFolder } from '../../core/engine.ts';
import { BUILT_IN_PRESETS } from '../../core/presets/index.ts';
import { BUILT_IN_RULES } from '../../core/rules/index.ts';
import type { Rule } from '../../core/rules/rule.ts';
import { locate, realPath } from '../../node/config-file.ts';
import { loadConfigFile } from '../../node/load-config.ts';
import { type Args, UsageError } from '../args.ts';
import type { Io } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';

/** What a list can show: the built-in rules and presets, and those of the configuration's plugins. */
interface Listed {
    readonly rules: Readonly<Record<string, Rule>>;
    readonly presets: Readonly<Record<string, Preset>>;
    readonly plugins: readonly Plugin[];
    readonly configPath: string | undefined;
}

/**
 * The rules and presets that can be named here: the configuration found (as a check finds it, with
 * `--config` and `--root`) is loaded for its plugins. Without one, the built-in ones.
 */
async function listed(args: Args, io: Io): Promise<Listed> {
    const cwd = realPath(io.cwd);
    const configArg = args.config === undefined ? undefined : resolve(cwd, args.config);
    if (configArg !== undefined && !existsSync(configArg)) {
        throw new UsageError(`--config ${args.config ?? ''}: ${configArg} does not exist`);
    }
    const rootArg = args.root === undefined ? undefined : resolve(cwd, args.root);
    if (rootArg !== undefined && !existsSync(rootArg)) {
        throw new UsageError(`--root ${args.root ?? ''}: ${rootArg} does not exist`);
    }
    const { configPath } = locate({ cwd, configPath: configArg, root: rootArg });
    if (configPath === undefined) {
        return { rules: BUILT_IN_RULES, presets: BUILT_IN_PRESETS, plugins: [], configPath };
    }
    const loaded = await loadConfigFile(configPath);
    return { rules: loaded.rules, presets: loaded.presets, plugins: loaded.plugins, configPath };
}

/** `(from crowded-folders-plugin-acme)` after a plugin's rule or preset; nothing after a built-in one. */
function origin(name: string, plugins: readonly Plugin[]): string {
    const slash = name.indexOf('/');
    if (slash === -1) {
        return '';
    }
    const plugin = plugins.find(candidate => candidate.meta.namespace === name.slice(0, slash));
    return plugin ? `  (from ${plugin.meta.name})` : '';
}

/** `crowded-folders presets`: every preset, built-in and of the plugins, what it does and where its criterion comes from. */
export async function listPresets(args: Args, io: Io): Promise<number> {
    const { presets, plugins } = await listed(args, io);
    const lines: string[] = [];
    for (const [name, preset] of Object.entries(presets)) {
        lines.push(`${name}${origin(name, plugins)}`, `  ${preset.description}`);
        for (const source of preset.sources) {
            lines.push(`  · ${source.title}: ${source.url}`);
        }
        lines.push('');
    }
    lines.push(
        plugins.length === 0
            ? 'Use them in "extends"; later ones win. Plugins add more, as "namespace/preset".'
            : 'Use them in "extends"; later ones win.',
    );
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

/** `crowded-folders rules`: every rule, built-in and of the plugins, with its options and their defaults. */
export async function listRules(args: Args, io: Io): Promise<number> {
    const { rules, plugins } = await listed(args, io);
    const lines: string[] = [];
    for (const [name, rule] of Object.entries(rules)) {
        lines.push(
            `${name}${origin(name, plugins)}`,
            `  ${rule.meta.description}`,
            `  options (defaults): ${JSON.stringify(rule.meta.defaultOptions)}`,
        );
        if (rule.meta.url) {
            lines.push(`  ${rule.meta.url}`);
        }
        lines.push('');
    }
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

/** `crowded-folders print-config [folder]`: the configuration after every preset and override, as JSON. */
export function printConfig(args: Args, io: Io, session: Session): number {
    const { config } = session.loaded;
    if (args.paths.length === 0) {
        io.write(
            `${JSON.stringify({ configFile: session.configPath ?? null, root: session.root, ...config }, undefined, 2)}\n`,
        );
        return 0;
    }
    const [folder = '.'] = foldersFromPaths(args.paths, session, io.cwd);
    const explanation = explainFolder({ files: session.files, config, rules: session.loaded.rules }, folder);
    const rules = Object.fromEntries(
        Object.entries(explanation?.rules ?? {}).map(([name, state]) => [
            name,
            [state.severity, state.effectiveOptions],
        ]),
    );
    const naming = explanation
        ? {
              companions: explanation.folder.naming.companions.map(pattern => pattern.source),
              ignoreLeadingWords: [...explanation.folder.naming.ignoreLeadingWords],
              groupNumericPrefixes: explanation.folder.naming.groupNumericPrefixes,
              folderFiles: explanation.folder.naming.folderFiles?.map(glob => glob.source) ?? [],
              folderCompanions: explanation.folder.naming.folderCompanions ?? [],
              folderCase: explanation.folder.naming.folderCase ?? 'kebab',
              reservedWords: [...(explanation.folder.naming.reservedWords ?? [])],
              keepInPlace: explanation.folder.naming.keepInPlace?.map(glob => glob.source) ?? [],
              routes: explanation.folder.naming.routes ?? false,
              groupFileStays: explanation.folder.naming.groupFileStays ?? false,
              mirrors: explanation.folder.naming.mirrors?.map(mirror => mirror.text) ?? [],
          }
        : config.naming;
    io.write(`${JSON.stringify({ folder, naming, rules, overrides: explanation?.overrides ?? [] }, undefined, 2)}\n`);
    return 0;
}
