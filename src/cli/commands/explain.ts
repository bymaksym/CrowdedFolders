import { explainFolder, type Finding } from '../../core/engine.ts';
import { groupModules, type GroupWords } from '../../core/naming/groups.ts';
import { type Module, type Naming, sameTopics, shownName } from '../../core/naming/modules.ts';
import { compileGlob, matchesSelfOrAncestor } from '../../core/paths/glob.ts';
import { normalisePath } from '../../core/paths/tree.ts';
import { plural } from '../../core/plural.ts';
import { asciiProse } from '../../core/report/ascii.ts';
import { describeComparison } from '../../core/report/tree/trial.ts';
import type { Args } from '../args.ts';
import { type Io, wantsSymbols } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';
import { isEmptyOption, labelOf, patternOrigin, ruleOrigins, withOverrides } from './provenance.ts';

/**
 * Shows one folder the way the rules see it: which overrides apply and why, how each file name was
 * read (stem, words, subject, group), the rules in effect with their options and where each value comes
 * from, and what they report. It is the answer to "why does it say that about this folder?" - and to
 * "why does it say nothing?": a folder the configuration leaves out says what left it out.
 */
export async function explain(args: Args, io: Io, session: Session): Promise<number> {
    const [path = '.'] = foldersFromPaths(args.paths, session, io.cwd);
    const folder = normalisePath(path) ?? '.';
    const explanation = explainFolder(
        { files: session.files, config: session.loaded.config, rules: session.loaded.rules },
        folder,
    );
    const say = wantsSymbols(io) ? (text: string): string => text : asciiProse;
    if (!explanation) {
        const lines = await notChecked(folder, session);
        io.write(say(`${lines.join('\n')}\n`));
        return 0;
    }
    const { folder: view, rules, overrides, findings, notes } = explanation;
    const lines: string[] = [
        `${view.path === '.' ? '. (the root)' : `${view.path}/`}  ${plural(view.files.length, 'file')}, ${plural(view.modules.length, 'module')}, ${plural(view.folders.length, 'subfolder')}`,
        ...compared(view.modules.length),
        '',
        'Overrides that apply',
    ];

    if (overrides.length === 0) {
        lines.push('  none');
    }
    for (const override of overrides) {
        lines.push(
            `  ${override.folders.join(', ')}  (${labelOf(override.origin, session)})`,
            `    ${override.reason}`,
        );
        const about = [
            override.owner === undefined ? undefined : `owner ${override.owner}`,
            override.ticket === undefined ? undefined : `ticket ${override.ticket}`,
            override.expires === undefined ? undefined : `expires ${override.expires}`,
        ].filter(part => part !== undefined);
        if (about.length > 0) {
            lines.push(`    ${about.join(', ')}`);
        }
    }

    lines.push(
        '',
        'Naming',
        `  companions:           ${view.naming.companions.map(pattern => `/${pattern.source}/`).join(' ') || 'none configured'}`,
        `  joined by:            ${joinedBy(view.modules, view.naming.companions.length > 0)}`,
        `  ignoreLeadingWords:   ${[...view.naming.ignoreLeadingWords].join(', ') || 'none'}`,
        `  groupNumericPrefixes: ${String(view.naming.groupNumericPrefixes)}`,
        `  folderFiles:          ${(view.naming.folderFiles ?? []).map(glob => glob.source).join(', ') || 'none'}`,
        `  folderCompanions:     ${(view.naming.folderCompanions ?? []).join(', ') || 'none'}`,
        `  folderCase:           ${view.naming.folderCase ?? 'kebab'}${view.naming.routes ? ' (routes: a group goes into a route group)' : ''}`,
        `  keepInPlace:          ${(view.naming.keepInPlace ?? []).map(glob => glob.source).join(', ') || 'none'}`,
        `  mirrors:              ${(view.naming.mirrors ?? []).map(mirror => mirror.text).join(', ') || 'none'}`,
    );

    const prefixOptions = rules['prefix-groups']?.effectiveOptions;
    const words: GroupWords =
        prefixOptions?.['words'] === 'auto' || typeof prefixOptions?.['words'] === 'number'
            ? prefixOptions['words']
            : 1;
    const min = typeof prefixOptions?.['min'] === 'number' ? prefixOptions['min'] : 2;
    const groupOf = new Map<Module, string>();
    for (const [key, members] of groupModules(view.modules, words, min, view.naming)) {
        for (const module of members) {
            groupOf.set(module, key);
        }
    }
    lines.push('', 'Modules (stem ← files · words · group)');
    for (const module of view.modules) {
        const key = groupOf.get(module) ?? '—';
        lines.push(`  ${module.stem} ← ${module.files.join(', ')}  · ${module.words.join(' ')}  · ${key}`);
    }
    if (view.uncounted && view.uncounted.length > 0) {
        lines.push('', 'Not counted');
        for (const { file, reason } of view.uncounted) {
            lines.push(`  ${file}  ${reason}`);
        }
    }
    const topics = sameTopics(view.modules);
    if (topics.length > 0) {
        lines.push('', 'Read as the same subject, counted as two');
        for (const topic of topics) {
            const names = topic.modules.map(shownName).join(', ');
            lines.push(
                `  ${names}  · ${topic.subject}: they group together, but each counts as a module; naming.companions ${JSON.stringify([topic.companion])} would make them one`,
            );
        }
    }

    const origins = withOverrides(await ruleOrigins(session), overrides, session);
    lines.push('', 'Rules in effect (value ← where it comes from)');
    for (const [name, state] of Object.entries(rules)) {
        if (state.severity === 'off') {
            continue;
        }
        const where = origins[name] ?? {};
        lines.push(`  ${state.severity.padEnd(5)} ${name} ← ${where['severity'] ?? 'default'}`);
        for (const [option, value] of Object.entries(state.effectiveOptions)) {
            if (!isEmptyOption(value)) {
                lines.push(`        ${option}: ${JSON.stringify(value)} ← ${where[option] ?? 'default'}`);
            }
        }
    }

    lines.push('', 'Problems');
    if (findings.length === 0) {
        lines.push('  none');
    }
    for (const finding of findings) {
        lines.push(`  ${finding.severity.padEnd(5)} ${finding.rule}  ${finding.message}`);
    }
    lines.push(...closeGroups(view.path, findings, view.modules, view.naming, words, min));
    if (notes.length > 0) {
        lines.push('', 'Not reported, and why');
        for (const note of notes) {
            lines.push(`  ${note.rule}  ${note.message}`);
        }
    }
    io.write(say(`${lines.join('\n')}\n`));
    return 0;
}

/**
 * For a folder over max-files with nothing to move out, the groups that come closest to the
 * minimum of prefix-groups: `core/enums (14/10): page-* ×3, ws-* ×2` says where a cut could start.
 */
function closeGroups(
    path: string,
    findings: readonly Finding[],
    modules: readonly Module[],
    naming: Naming,
    words: GroupWords,
    min: number,
): string[] {
    const crowded = findings.find(finding => finding.rule === 'max-files');
    if (!crowded || findings.some(finding => finding.moves.length > 0)) {
        return [];
    }
    const close = [...groupModules(modules, words, min, naming)]
        .filter(([, members]) => members.length >= 2 && members.length < min)
        .toSorted(([a, left], [b, right]) => right.length - left.length || (a < b ? -1 : 1))
        .slice(0, 8)
        .map(([key, members]) => `${key}-* ×${members.length}`);
    const limit = crowded.limit === undefined ? String(crowded.measured) : `${crowded.measured}/${crowded.limit}`;
    return [
        '',
        `Groups that come close (prefix-groups needs ${min})`,
        `  ${path} (${limit}): ${close.length > 0 ? close.join(', ') : 'none: no two modules start with the same word'}`,
    ];
}

/**
 * How files became one module, for the ones that did. A name is read up to its first dot, so
 * `date.utils.spec.ts` goes with `date.utils.ts` with no companion configured at all: saying "none"
 * there hides the rule that grouped them.
 */
function joinedBy(modules: readonly Module[], hasCompanions: boolean): string {
    const joined = modules.filter(module => module.files.length > 1);
    if (joined.length === 0) {
        return 'nothing: every file is a module of its own';
    }
    const shown = joined.slice(0, 3).map(module => `${module.files.join(' + ')} → ${module.stem}`);
    const more = joined.length > 3 ? `, and ${joined.length - 3} more` : '';
    return `the name up to its first dot${hasCompanions ? ', and the companions above' : ''} (${plural(joined.length, 'module')}: ${shown.join('; ')}${more})`;
}

/**
 * A folder that no rule looks at, and what left it out: the exclude that took it (with the preset or file
 * that wrote it), an include that does not reach it, or git not listing a file in it. Not an error: the
 * answer to "why does it say nothing about this folder?".
 */
async function notChecked(folder: string, session: Session): Promise<string[]> {
    const { config } = session.loaded;
    const under = folder === '.' ? session.files : session.files.filter(file => file.startsWith(`${folder}/`));
    const lines = [`${folder === '.' ? '. (the root)' : `${folder}/`}  is not checked`];
    if (under.length === 0) {
        lines.push(
            '  no file in it is listed: it is empty, or .gitignore hides it, or git does not know its files yet (untracked files are not counted with --tracked-only or on CI)',
        );
        return lines;
    }
    const exclude = config.exclude.map(pattern => ({ pattern, glob: compileGlob(pattern) }));
    const include = config.include.map(compileGlob);
    const reasons = new Map<string, number>();
    for (const file of under) {
        const excluded = exclude.find(({ glob }) => matchesSelfOrAncestor(file, [glob]));
        let reason = 'not checked for a reason this command cannot name';
        if (excluded) {
            reason = `excluded by ${excluded.pattern} (${await patternOrigin(session, 'exclude', excluded.pattern)})`;
        } else if (include.length > 0 && !matchesSelfOrAncestor(file, include)) {
            reason = `not taken by include (${config.include.join(', ')})`;
        }
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    for (const [reason, count] of reasons) {
        lines.push(`  ${count === under.length ? `all ${plural(count, 'file')}` : plural(count, 'file')}: ${reason}`);
    }
    return lines;
}

/** How big the folder is among the folders of the field trial, as a line of its own; nothing when there are no modules. */
function compared(modules: number): string[] {
    const sentence = describeComparison(modules);
    return sentence === undefined ? [] : [`  ${sentence}`];
}
