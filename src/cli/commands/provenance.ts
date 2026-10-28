import type { Config, OverrideState, RuleSetting } from '../../core/config/types.ts';
import { shownPath } from '../../node/config/error.ts';
import { readConfigFile } from '../../node/config/file.ts';
import type { Session } from '../session.ts';

/** Rule → setting (`severity`, or an option's name) → where its value was last set. */
export type Origins = Record<string, Record<string, string>>;

/** What a layer of the configuration is called to a person: `preset angular`, or the file from where the command ran. */
export function labelOf(origin: string, session: Session): string {
    const preset = /^preset "(.+)"$/u.exec(origin)?.[1];
    if (preset !== undefined) {
        return `preset ${preset}`;
    }
    return origin.startsWith('(') ? origin : shownPath(session.cwd, origin);
}

/** The layers of the configuration as they were written, in the order they were applied. */
async function layersOf(session: Session): Promise<{ readonly label: string; readonly config: Config }[]> {
    const layers: { label: string; config: Config }[] = [];
    for (const origin of session.loaded.config.layers) {
        const preset = /^preset "(.+)"$/u.exec(origin)?.[1];
        try {
            const raw = preset === undefined ? await readConfigFile(origin) : session.loaded.presets[preset]?.config;
            if (typeof raw === 'object' && raw !== null) {
                layers.push({ label: labelOf(origin, session), config: raw });
            }
        } catch {
            // A layer that cannot be read again is left out of the story, not an error: the run read it once.
        }
    }
    return layers;
}

/** Which layer set each rule's severity and options, replayed in the order they were applied. */
export async function ruleOrigins(session: Session): Promise<Origins> {
    const origins: Origins = {};
    for (const { label, config } of await layersOf(session)) {
        for (const [rule, setting] of Object.entries(config.rules ?? {})) {
            const known = (origins[rule] ??= {});
            known['severity'] = label;
            for (const key of optionKeys(setting)) {
                known[key] = label;
            }
        }
    }
    return origins;
}

/** Which layer first wrote an `exclude` or `include` pattern. */
export async function patternOrigin(session: Session, key: 'exclude' | 'include', pattern: string): Promise<string> {
    for (const { label, config } of await layersOf(session)) {
        if (config[key]?.includes(pattern)) {
            return label;
        }
    }
    return labelOf(session.configPath ?? '(the command line)', session);
}

/** The origins after the overrides that apply to a folder, each saying which override it was. */
export function withOverrides(origins: Origins, overrides: readonly OverrideState[], session: Session): Origins {
    const result: Origins = Object.fromEntries(Object.entries(origins).map(([rule, known]) => [rule, { ...known }]));
    for (const override of overrides) {
        const label = `${labelOf(override.origin, session)}, override ${override.folders.join(' ')}`;
        for (const [rule, setting] of Object.entries(override.rules)) {
            const known = (result[rule] ??= {});
            known['severity'] = label;
            for (const key of optionKeys(setting)) {
                known[key] = label;
            }
        }
    }
    return result;
}

/** An option that says nothing: `""`, `[]`, `{}`, nothing. Hidden, so that the rest can be read. */
export function isEmptyOption(value: unknown): boolean {
    return typeof value === 'object' && value !== null
        ? Object.keys(value).length === 0
        : [undefined, null, ''].includes(value as undefined);
}

/** The options a rule setting writes: none for a bare severity. */
function optionKeys(setting: RuleSetting): string[] {
    return typeof setting === 'string' ? [] : Object.keys(setting[1] ?? {});
}
