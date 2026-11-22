import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { JsonSchema } from '../../core/config/json-schema.ts';
import { NAMING } from '../../core/config/schema.ts';
import type { Plugin, Preset } from '../../core/config/types.ts';
import { docsUrl } from '../../core/docs-url.ts';
import { explainFolder } from '../../core/engine.ts';
import { closest } from '../../core/paths/suggest.ts';
import { BUILT_IN_PRESETS } from '../../core/presets/index.ts';
import { asciiProse, wrapWords } from '../../core/report/ascii.ts';
import { BUILT_IN_RULES } from '../../core/rules/index.ts';
import type { Rule } from '../../core/rules/rule.ts';
import { shownPath } from '../../node/config/error.ts';
import { locate } from '../../node/config/file.ts';
import { realPath } from '../../node/config/real-path.ts';
import { loadConfigFile } from '../../node/load-config.ts';
import { type Args, UsageError } from '../args.ts';
import { type Io, terminalWidth, wantsSymbols } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';
import { isEmptyOption, originPath, ruleOrigins, withOverrides } from './provenance.ts';

/** Where a pipe wraps: the width of a terminal is not known there, and 100 columns is what a diff or a mail shows. */
const PIPE_WIDTH = 100;

/** The entries whose name contains what was typed (any case); all of them when nothing was typed. */
function matching<T>(
    entries: readonly (readonly [string, T])[],
    typed: string | undefined,
    noun: string,
    elsewhere = false,
): readonly (readonly [string, T])[] {
    if (typed === undefined) {
        return entries;
    }
    const wanted = typed.toLowerCase();
    const found = entries.filter(([name]) => name.toLowerCase().includes(wanted));
    // What was typed names something else the command lists (a naming option): not a mistake.
    if (found.length > 0 || elsewhere) {
        return found;
    }
    const guess = closest(
        typed,
        entries.map(([name]) => name),
    );
    throw new UsageError(
        `no ${noun} matches "${typed}"${guess === undefined ? '' : `; did you mean ${guess}?`} (crowded-folders ${noun}s lists them)`,
    );
}

/** A text indented, and cut at the width of the terminal with the same indent on every line. */
function wrapped(text: string, indent: number, width: number): string[] {
    return wrapWords(text, width, indent, indent).map(line => `${' '.repeat(indent)}${line}`);
}

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
    const loaded = await loadConfigFile(configPath, { code: args.code });
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

/**
 * `crowded-folders presets [name]`: every preset, built-in and of the plugins, what it does and where its
 * criterion comes from.
 */
export async function listPresets(args: Args, io: Io): Promise<number> {
    const { presets, plugins } = await listed(args, io);
    const width = terminalWidth(io) ?? PIPE_WIDTH;
    const say = wantsSymbols(io) ? (text: string): string => text : asciiProse;
    const lines: string[] = [];
    for (const [name, preset] of matching(Object.entries(presets), args.paths[0], 'preset')) {
        lines.push(`${name}${origin(name, plugins)}`, ...wrapped(say(preset.description), 2, width));
        for (const source of preset.sources) {
            lines.push(`  ${wantsSymbols(io) ? '·' : '-'} ${say(source.title)}: ${source.url}`);
        }
        lines.push('');
    }
    lines.push(
        ...wrapped(
            plugins.length === 0
                ? 'Use them in "extends"; later ones win. Plugins add more, as "namespace/preset".'
                : 'Use them in "extends"; later ones win.',
            0,
            width,
        ),
    );
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

/** A naming option's default, unless it is an empty list: there is nothing to say then. */
function shownDefault(value: unknown): string {
    return value === undefined || (Array.isArray(value) && value.length === 0)
        ? ''
        : ` (default ${JSON.stringify(value)})`;
}

/** The `naming` options that match what was typed: all of them for nothing, or for "naming". */
function namingMatching(typed: string | undefined): readonly (readonly [string, JsonSchema])[] {
    const options = Object.entries(NAMING.properties ?? {});
    return typed === undefined || typed.toLowerCase() === 'naming'
        ? options
        : options.filter(([name]) => name.toLowerCase().includes(typed.toLowerCase()));
}

/**
 * `crowded-folders rules [name]`: every rule, built-in and of the plugins, with its options and their
 * defaults, then the `naming` options, which are not a rule's but are what most of a name's reading is set with.
 */
export async function listRules(args: Args, io: Io): Promise<number> {
    const { rules, plugins } = await listed(args, io);
    const width = terminalWidth(io) ?? PIPE_WIDTH;
    const typed = args.paths[0];
    const say = wantsSymbols(io) ? (text: string): string => text : asciiProse;
    const naming = namingMatching(typed);
    const lines: string[] = [];
    const found = matching(Object.entries(rules), typed, 'rule', naming.length > 0);
    for (const [name, rule] of found) {
        const options = Object.entries(rule.meta.defaultOptions)
            .map(([option, value]) => `${option}: ${JSON.stringify(value)}`)
            .join(', ');
        lines.push(
            `${name}${origin(name, plugins)}`,
            ...wrapped(say(rule.meta.description), 2, width),
            ...(options === '' ? [] : wrapped(say(`options (defaults): ${options}`), 2, width)),
        );
        if (rule.meta.url) {
            lines.push(`  ${rule.meta.url}`);
        }
        lines.push('');
    }
    if (naming.length > 0) {
        lines.push(
            'naming (settings, not a rule: how names are read, in a configuration or an override)',
            ...naming.flatMap(([name, option]) => [
                `  ${name}${shownDefault(option.default)}`,
                ...wrapped(say(option.description ?? ''), 4, width),
            ]),
            `  ${docsUrl('configuring.md#naming')}`,
            '',
        );
    }
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

/**
 * `crowded-folders print-config [folder]`: the configuration after every preset and override, as JSON.
 * For a folder, every rule with the options that matter there (the empty ones left out) and, apart,
 * where each value comes from.
 */
export async function printConfig(args: Args, io: Io, session: Session): Promise<number> {
    const { config } = session.loaded;
    const origins = await ruleOrigins(session);
    // Paths from where the command was typed: the machine's folders stay out of what is pasted in an issue.
    const shown = (origin: string): string => originPath(origin, session);
    const withOrigins = <T extends { readonly origin: string }>(states: readonly T[]): T[] =>
        states.map(state => ({ ...state, origin: shown(state.origin) }));
    if (args.paths.length === 0) {
        const printed = {
            configFile: session.configPath === undefined ? null : shown(session.configPath),
            root: shownPath(session.cwd, session.root),
            ...config,
            layers: config.layers.map(origin => shown(origin)),
            overrides: withOrigins(config.overrides),
            origins,
        };
        io.write(`${JSON.stringify(printed, undefined, 2)}\n`);
        return 0;
    }
    const [folder = '.'] = foldersFromPaths(args.paths, session, io.cwd);
    const explanation = explainFolder({ files: session.files, config, rules: session.loaded.rules }, folder);
    const rules = Object.fromEntries(
        Object.entries(explanation?.rules ?? {}).map(([name, state]) => [
            name,
            [
                state.severity,
                Object.fromEntries(Object.entries(state.effectiveOptions).filter(([, value]) => !isEmptyOption(value))),
            ],
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
    const overrides = explanation?.overrides ?? [];
    io.write(
        `${JSON.stringify({ folder, naming, rules, origins: withOverrides(origins, overrides, session), overrides: withOrigins(overrides) }, undefined, 2)}\n`,
    );
    return 0;
}
