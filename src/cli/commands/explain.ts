import { explainFolder, type Finding } from '../../core/engine.ts';
import { groupModules, type GroupWords } from '../../core/naming/groups.ts';
import { type Module, type Naming, sameTopics, shownName } from '../../core/naming/modules.ts';
import { normalisePath } from '../../core/paths/tree.ts';
import { type Args, UsageError } from '../args.ts';
import type { Io } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';

/**
 * Shows one folder the way the rules see it: which overrides apply and why, how each file name was
 * read (stem, words, subject, group), the rules in effect with their options, and what they report.
 * It is the answer to "why does it say that about this folder?".
 */
export function explain(args: Args, io: Io, session: Session): number {
    const [path = '.'] = foldersFromPaths(args.paths, session, io.cwd);
    const folder = normalisePath(path) ?? '.';
    const explanation = explainFolder(
        { files: session.files, config: session.loaded.config, rules: session.loaded.rules },
        folder,
    );
    if (!explanation) {
        throw new UsageError(`${folder} holds no file that is checked (it is empty, excluded, or not in git)`);
    }
    const { folder: view, rules, overrides, findings, notes } = explanation;
    const lines: string[] = [
        `${view.path === '.' ? '. (the root)' : `${view.path}/`}  ${view.files.length} files, ${view.modules.length} modules, ${view.folders.length} subfolders`,
        '',
        'Overrides that apply',
    ];

    if (overrides.length === 0) {
        lines.push('  none');
    }
    for (const override of overrides) {
        lines.push(`  ${override.folders.join(', ')}  (${override.origin})`, `    ${override.reason}`);
    }

    lines.push(
        '',
        'Naming',
        `  companions:           ${view.naming.companions.map(pattern => `/${pattern.source}/`).join(' ') || 'none'}`,
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

    lines.push('', 'Rules in effect');
    for (const [name, state] of Object.entries(rules)) {
        if (state.severity === 'off') {
            continue;
        }
        lines.push(`  ${state.severity.padEnd(5)} ${name}  ${JSON.stringify(state.effectiveOptions)}`);
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
    io.write(`${lines.join('\n')}\n`);
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
