import { explainFolder } from '../../core/engine.ts';
import { groupModules, type GroupWords } from '../../core/naming/groups.ts';
import { type Module, sameTopics, shownName } from '../../core/naming/modules.ts';
import { normalisePath } from '../../core/paths/tree.ts';
import { plural } from '../../core/plural.ts';
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
        `${view.path === '.' ? '. (the root)' : `${view.path}/`}  ${plural(view.files.length, 'file')}, ${plural(view.modules.length, 'module')}, ${plural(view.folders.length, 'subfolder')}`,
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
    if (notes.length > 0) {
        lines.push('', 'Not reported, and why');
        for (const note of notes) {
            lines.push(`  ${note.rule}  ${note.message}`);
        }
    }
    io.write(`${lines.join('\n')}\n`);
    return 0;
}
