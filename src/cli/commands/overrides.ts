import type { OverrideState, RuleSetting } from '../../core/config/types.ts';
import { overrideCoverage } from '../../core/engine.ts';
import type { Args } from '../args.ts';
import type { Io } from '../io.ts';
import type { Session } from '../session.ts';

/**
 * Past this share of the folders, an override that silences a rule is said to be broad: it is the
 * rule of the repository, not an exception, and belongs in `rules`. An opinion, not a measurement.
 */
export const BROAD_SHARE = 0.25;

/** How many folders of an override are named before "and N more". */
const SHOWN_FOLDERS = 5;

/**
 * `crowded-folders overrides`: every override in effect, where it comes from, the folders it
 * applies to and what it changes there. An override of the configuration's own files that turns a
 * rule off or down over more than a quarter of the folders is pointed out: `"folders": ["**"]` with
 * the rules off leaves a repository green without a word. Returns 0; it reports, it does not judge.
 */
export function overrides(args: Args, io: Io, session: Session): number {
    const coverage = overrideCoverage({
        files: session.files,
        config: session.loaded.config,
        rules: session.loaded.rules,
        ...(session.only && { only: session.only }),
    });
    const total = coverage.folderCount;
    const rows = coverage.overrides.map(({ state, folders }) => {
        const share = total === 0 ? 0 : folders.length / total;
        const silences = silenced(state.rules);
        return { state, folders, share, silences, isBroad: state.own && share > BROAD_SHARE && silences.length > 0 };
    });
    if (args.format === 'json') {
        const json = {
            folders: total,
            broadShare: BROAD_SHARE,
            overrides: rows.map(({ state, folders, share, silences, isBroad }) => ({
                origin: state.origin,
                own: state.own,
                folders: state.folders,
                withFiles: state.withFiles,
                within: state.within,
                reason: state.reason,
                owner: state.owner ?? null,
                ticket: state.ticket ?? null,
                expires: state.expires ?? null,
                rules: state.rules,
                naming: state.naming,
                covers: folders,
                share,
                silences,
                broad: isBroad,
            })),
        };
        io.write(`${JSON.stringify(json, undefined, 2)}\n`);
        return 0;
    }
    const lines: string[] = [];
    let origin: string | undefined;
    for (const { state, folders, share, silences, isBroad } of rows) {
        if (state.origin !== origin) {
            origin = state.origin;
            lines.push(lines.length === 0 ? origin : `\n${origin}`);
        }
        lines.push(`  ${describeFolders(state)}${about(state)}`, `    ${state.reason}`);
        const percent = `${Math.round(share * 100)} %`;
        const shown = folders.slice(0, SHOWN_FOLDERS).join(', ');
        const more = folders.length > SHOWN_FOLDERS ? `, and ${folders.length - SHOWN_FOLDERS} more` : '';
        lines.push(
            folders.length === 0
                ? '    covers no folder'
                : `    covers ${folders.length} of ${total} folders (${percent}): ${shown}${more}`,
        );
        const changes = changesOf(state);
        if (changes.length > 0) {
            lines.push(`    ${changes.join('; ')}`);
        }
        if (isBroad) {
            lines.push(
                `    ⚠ silences ${silences.join(', ')} in ${percent} of the folders, more than ${Math.round(BROAD_SHARE * 100)} %: that is the rule of the repository, not an exception — set it in "rules", or narrow "folders"`,
            );
        }
    }
    if (rows.length === 0) {
        lines.push('No overrides.');
    }
    io.write(`${lines.join('\n')}\n`);
    return 0;
}

function describeFolders(state: OverrideState): string {
    const folders = state.folders.map(glob => `"${glob}"`).join(', ');
    const withFiles = state.withFiles.length > 0 ? ` with ${state.withFiles.join(', ')}` : '';
    const within = state.within.length > 0 ? ` within ${state.within.join(', ')}` : '';
    return `${folders}${withFiles}${within}`;
}

function about(state: OverrideState): string {
    const parts = [
        state.owner === undefined ? undefined : `owner ${state.owner}`,
        state.ticket === undefined ? undefined : `ticket ${state.ticket}`,
        state.expires === undefined ? undefined : `expires ${state.expires}`,
    ].filter(part => part !== undefined);
    return parts.length > 0 ? `  (${parts.join(', ')})` : '';
}

/** The rules an override turns off or down to a warning. */
function silenced(rules: Readonly<Record<string, RuleSetting>>): string[] {
    return Object.entries(rules)
        .filter(([, setting]) => {
            const severity = typeof setting === 'string' ? setting : setting[0];
            return severity === 'off' || severity === 'warn';
        })
        .map(([name]) => name);
}

/** What an override changes, in a few words each: `max-files off`, `max-files error {"max":40}`. */
function changesOf(state: OverrideState): string[] {
    const changes = Object.entries(state.rules).map(([name, setting]) => {
        if (typeof setting === 'string') {
            return `${name} ${setting}`;
        }
        const [severity, options] = setting;
        return `${name} ${severity}${options === undefined ? '' : ` ${JSON.stringify(options)}`}`;
    });
    const naming = Object.keys(state.naming);
    if (naming.length > 0) {
        changes.push(`naming: ${naming.join(', ')}`);
    }
    return changes;
}
