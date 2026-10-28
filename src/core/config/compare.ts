import type { Finding } from '../findings.ts';
import { plural } from '../plural.ts';
import type { Rule } from '../rules/rule.ts';
import { mergeOptions } from './merge.ts';
import type { OverrideState, ResolvedConfig, RuleState } from './types.ts';

/**
 * What a change to the configuration does (`--compare-config <ref>`): the settings it changes, read
 * from both configurations resolved, and the problems it silences or adds, read from running both
 * over the same files. "This change raises max-files to 40 and silences 37 problems in 12 folders":
 * a pull request that loosens a limit says so in its own words, not only in a diff of JSON.
 */
export interface ConfigChange {
    /** The ref the configuration was read at, as given: `origin/main`. */
    readonly label: string;
    /** One phrase per setting changed, in the order of the rules: "raises max-files max to 40". */
    readonly settings: readonly string[];
    /** Problems of the old configuration that the new one does not report, or reports smaller. */
    readonly silenced: number;
    readonly silencedFolders: number;
    /** Problems the new configuration reports that the old one did not, or reported smaller. */
    readonly added: number;
    readonly addedFolders: number;
    /** The whole of it in one sentence, for the text, the Markdown and the JSON. */
    readonly summary: string;
}

export function compareConfigs(input: {
    readonly label: string;
    readonly before: ResolvedConfig;
    readonly after: ResolvedConfig;
    readonly rules: Readonly<Record<string, Rule>>;
    readonly beforeFindings: readonly Finding[];
    readonly afterFindings: readonly Finding[];
}): ConfigChange {
    const settings = [
        ...ruleChanges(input.before.rules, input.after.rules, input.rules),
        ...listChange('exclude', 'pattern', input.before.exclude, input.after.exclude),
        ...listChange('include', 'pattern', input.before.include, input.after.include),
        ...overrideChange(input.before.overrides, input.after.overrides),
    ];
    const silenced = lostFrom(input.beforeFindings, input.afterFindings);
    const added = lostFrom(input.afterFindings, input.beforeFindings);
    const silencedFolders = new Set(silenced.map(finding => finding.folder)).size;
    const addedFolders = new Set(added.map(finding => finding.folder)).size;
    const effects = [
        silenced.length > 0 && `silences ${plural(silenced.length, 'problem')} in ${plural(silencedFolders, 'folder')}`,
        added.length > 0 && `adds ${plural(added.length, 'problem')} in ${plural(addedFolders, 'folder')}`,
    ].filter(text => text !== false);
    const parts = [...settings, ...effects];
    const summary =
        parts.length === 0
            ? `The configuration is as it was on ${input.label}, in effect.`
            : `Since ${input.label}, the configuration ${joinWords(parts)}${effects.length === 0 ? ', and reports the same problems' : ''}.`;
    return {
        label: input.label,
        settings,
        silenced: silenced.length,
        silencedFolders,
        added: added.length,
        addedFolders,
        summary,
    };
}

/** What each rule's setting at the root became: its severity, then each option that changed. */
function ruleChanges(
    before: Readonly<Record<string, RuleState>>,
    after: Readonly<Record<string, RuleState>>,
    rules: Readonly<Record<string, Rule>>,
): string[] {
    const changes: string[] = [];
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const was = before[name];
        const now = after[name];
        const severityWas = was?.severity ?? 'off';
        const severityNow = now?.severity ?? 'off';
        if (severityNow === 'off' && severityWas !== 'off') {
            changes.push(`turns ${name} off`);
            continue;
        }
        if (severityWas === 'off' && severityNow !== 'off') {
            changes.push(`turns ${name} on (${severityNow})`);
            continue;
        }
        if (severityNow === 'off') {
            continue;
        }
        if (severityWas !== severityNow) {
            changes.push(`makes ${name} ${severityNow === 'warn' ? 'a warning' : 'an error'}`);
        }
        const defaults = (rules[name]?.meta.defaultOptions ?? {}) as Record<string, unknown>;
        const optionsWas = mergeOptions(defaults, was?.options ?? {});
        const optionsNow = mergeOptions(defaults, now?.options ?? {});
        for (const option of new Set([...Object.keys(optionsWas), ...Object.keys(optionsNow)])) {
            const a = optionsWas[option];
            const b = optionsNow[option];
            if (JSON.stringify(a) === JSON.stringify(b)) {
                continue;
            }
            if (typeof a === 'number' && typeof b === 'number') {
                changes.push(`${b > a ? 'raises' : 'lowers'} ${name} ${option} from ${a} to ${b}`);
            } else if (Array.isArray(a) && Array.isArray(b)) {
                changes.push(...listChange(`${name} ${option}`, 'entry', a, b));
            } else {
                changes.push(
                    b === undefined ? `unsets ${name} ${option}` : `sets ${name} ${option} to ${JSON.stringify(b)}`,
                );
            }
        }
    }
    return changes;
}

function listChange(what: string, unit: string, before: readonly unknown[], after: readonly unknown[]): string[] {
    const was = new Set(before.map(item => JSON.stringify(item)));
    const now = new Set(after.map(item => JSON.stringify(item)));
    const added = [...now].filter(item => !was.has(item)).length;
    const removed = [...was].filter(item => !now.has(item)).length;
    return [
        ...(added > 0 ? [`adds ${plural(added, unit)} to ${what}`] : []),
        ...(removed > 0 ? [`takes ${plural(removed, unit)} out of ${what}`] : []),
    ];
}

function overrideChange(before: readonly OverrideState[], after: readonly OverrideState[]): string[] {
    const id = (state: OverrideState): string =>
        JSON.stringify([state.origin, state.folders, state.withFiles, state.rules, state.naming]);
    const was = new Set(before.map(id));
    const now = new Set(after.map(id));
    const added = [...now].filter(item => !was.has(item)).length;
    const removed = [...was].filter(item => !now.has(item)).length;
    return [
        ...(added > 0 ? [`adds ${plural(added, 'override')}`] : []),
        ...(removed > 0 ? [`removes ${plural(removed, 'override')}`] : []),
    ];
}

/** The findings of `from` that `to` does not have, or has smaller: by folder, rule and key. */
function lostFrom(from: readonly Finding[], to: readonly Finding[]): Finding[] {
    const measured = new Map<string, number>();
    const keyOf = (finding: Finding): string => `${finding.folder}\0${finding.rule}\0${finding.key ?? ''}`;
    for (const finding of to) {
        measured.set(keyOf(finding), Math.max(measured.get(keyOf(finding)) ?? -1, finding.measured));
    }
    return from.filter(finding => {
        const other = measured.get(keyOf(finding));
        return other === undefined || other < finding.measured;
    });
}

/** "a, b and c". */
function joinWords(parts: readonly string[]): string {
    return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}
