import { explainFolder } from '../../core/engine.ts';
import { closest } from '../../core/paths/suggest.ts';
import { BUILT_IN_PRESETS } from '../../core/presets/index.ts';
import { asciiProse, wrapWords } from '../../core/report/ascii.ts';
import { BUILT_IN_RULES } from '../../core/rules/index.ts';
import { type Args, UsageError } from '../args.ts';
import { type Io, terminalWidth, wantsSymbols } from '../io.ts';
import { isEmptyOption, ruleOrigins, withOverrides } from '../provenance.ts';
import { foldersFromPaths, type Session } from '../session.ts';

/** Where a pipe wraps: the width of a terminal is not known there, and 100 columns is what a diff or a mail shows. */
const PIPE_WIDTH = 100;

/** The entries whose name contains what was typed (any case); all of them when nothing was typed. */
function matching<T>(
    entries: readonly (readonly [string, T])[],
    typed: string | undefined,
    noun: string,
): readonly (readonly [string, T])[] {
    if (typed === undefined) {
        return entries;
    }
    const wanted = typed.toLowerCase();
    const found = entries.filter(([name]) => name.toLowerCase().includes(wanted));
    if (found.length > 0) {
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

/** `crowded-folders presets [name]`: the built-in presets, what each does and where its criterion comes from. */
export function listPresets(args: Args, io: Io): number {
    const width = terminalWidth(io) ?? PIPE_WIDTH;
    const say = wantsSymbols(io) ? (text: string): string => text : asciiProse;
    const lines: string[] = [];
    for (const [name, preset] of matching(Object.entries(BUILT_IN_PRESETS), args.paths[0], 'preset')) {
        lines.push(name, ...wrapped(say(preset.description), 2, width));
        for (const source of preset.sources) {
            lines.push(`  ${wantsSymbols(io) ? '·' : '-'} ${source.title}: ${source.url}`);
        }
        lines.push('');
    }
    lines.push(...wrapped('Use them in "extends"; later ones win. Plugins add more, as "namespace/preset".', 0, width));
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

/** `crowded-folders rules [name]`: the built-in rules with their options and the defaults. */
export function listRules(args: Args, io: Io): number {
    const width = terminalWidth(io) ?? PIPE_WIDTH;
    const lines: string[] = [];
    for (const [name, rule] of matching(Object.entries(BUILT_IN_RULES), args.paths[0], 'rule')) {
        const options = Object.entries(rule.meta.defaultOptions)
            .map(([option, value]) => `${option}: ${JSON.stringify(value)}`)
            .join(', ');
        lines.push(
            name,
            ...wrapped(rule.meta.description, 2, width),
            ...wrapped(`options (defaults): ${options}`, 2, width),
        );
        if (rule.meta.url) {
            lines.push(`  ${rule.meta.url}`);
        }
        lines.push('');
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
    if (args.paths.length === 0) {
        io.write(
            `${JSON.stringify({ configFile: session.configPath ?? null, root: session.root, ...config, origins }, undefined, 2)}\n`,
        );
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
          }
        : config.naming;
    const overrides = explanation?.overrides ?? [];
    io.write(
        `${JSON.stringify({ folder, naming, rules, origins: withOverrides(origins, overrides, session), overrides }, undefined, 2)}\n`,
    );
    return 0;
}
