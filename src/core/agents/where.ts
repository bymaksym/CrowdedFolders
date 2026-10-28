import { foldersOf } from '../changes.ts';
import type { ResolvedConfig } from '../config/types.ts';
import { explainFolder, type Finding, runEngine, selectFiles } from '../engine.ts';
import { groupModules, MAX_KEY_WORDS } from '../naming/groups.ts';
import { compareText, shownName } from '../naming/modules.ts';
import { baseName, joinPath, parentOf } from '../paths/tree.ts';
import { existingFolder, folderNameFor } from '../rules/moves.ts';
import type { Move, Rule } from '../rules/rule.ts';

export interface WhereInput {
    /** The files that exist, relative to the root. */
    readonly files: readonly string[];
    readonly config: ResolvedConfig;
    readonly rules: Readonly<Record<string, Rule>>;
    /** The file that would be added, relative to the root and normalised (`/`, no `./`). */
    readonly path: string;
    /** `YYYY-MM-DD`, as for `runEngine`. */
    readonly today?: string;
}

/**
 * What adding the file does to the problems of its folder:
 * `creates` a problem the folder did not have, `worsens` one it has, `fixes` one (a folder with a single
 * file gets its second), or `neutral`. `exists` and `unchecked` mean there is nothing to say: the file is
 * already there, or no rule looks at that place.
 */
export type WhereEffect = 'creates' | 'exists' | 'fixes' | 'neutral' | 'unchecked' | 'worsens';

/** One problem of the folder before and after the file: `same` is one the folder already had and the file leaves as it is. */
export interface WhereChange {
    readonly change: 'fixed' | 'new' | 'same' | 'worse';
    readonly rule: string;
    readonly severity: 'error' | 'warn';
    readonly folder: string;
    readonly key: string | undefined;
    /** Measured without the file; `undefined` when the folder did not have the problem. */
    readonly before: number | undefined;
    /** Measured with the file; `undefined` when the file removes the problem. */
    readonly after: number | undefined;
    readonly limit: number | undefined;
    /** The rule's message about the folder with the file in it (without it, for `fixed`). */
    readonly message: string;
    /** The moves the problem proposes that involve the new file. */
    readonly moves: readonly Move[];
}

/** A place the file could go. */
export interface WhereCandidate {
    /** Relative to the root. */
    readonly folder: string;
    /** `folder`: it exists and is named after the file's group; `move`: where the rule that complains would put it. */
    readonly kind: 'folder' | 'move';
    readonly reason: string;
}

/** The modules the folder already has that start like the new file. */
export interface WhereGroup {
    readonly key: string;
    /** The stems of the others, sorted. */
    readonly modules: readonly string[];
    /** How many `prefix-groups` needs to ask for a folder. */
    readonly min: number;
}

export interface WhereResult {
    readonly path: string;
    /** The folder the file would be in. */
    readonly folder: string;
    readonly effect: WhereEffect;
    /** Why `unchecked` (excluded, or no rule is on there). */
    readonly note?: string;
    readonly changes: readonly WhereChange[];
    readonly candidates: readonly WhereCandidate[];
    readonly group?: WhereGroup;
}

/**
 * Says whether a file at `path` would create, worsen or leave as it is a problem in its folder, and
 * where else it could go. The folder is checked twice, without and with the file, by the same engine
 * as a normal run, so it can never disagree with `check` about the folder once the file is there; only
 * the folder the file lands in is reported (and the nearest existing folder above it when the file
 * makes a new one: `max-folders` is about the parent).
 */
export function whereWouldGo(input: WhereInput): WhereResult {
    const { files, config, rules, path } = input;
    const folder = parentOf(path);
    const base = { path, folder };
    if (files.includes(path)) {
        return { ...base, effect: 'exists', changes: [], candidates: [] };
    }
    if (selectFiles([path], config).length === 0) {
        return {
            ...base,
            effect: 'unchecked',
            note: 'the configuration leaves it out (include or exclude)',
            changes: [],
            candidates: [],
        };
    }

    const known = foldersOf(files);
    let anchor = folder;
    while (anchor !== '.' && !known.has(anchor)) {
        anchor = parentOf(anchor);
    }
    const concerned = new Set([folder, anchor]);
    const options = { config, rules, only: [anchor], ...(input.today !== undefined && { today: input.today }) };
    const withFile = [...files, path];
    const before = runEngine({ ...options, files }).findings.filter(finding => concerned.has(finding.folder));
    const after = runEngine({ ...options, files: withFile }).findings.filter(finding => concerned.has(finding.folder));
    const changes = compareFindings(before, after, path);
    const effect = effectOf(changes);

    const { candidates, group } = placesFor(input, withFile, changes);
    return { ...base, effect, changes, candidates, ...(group && { group }) };
}

function keyOf(finding: Finding): string {
    return `${finding.folder}\0${finding.rule}\0${finding.key ?? ''}`;
}

function compareFindings(before: readonly Finding[], after: readonly Finding[], path: string): WhereChange[] {
    const earlier = new Map(before.map(finding => [keyOf(finding), finding]));
    const changes: WhereChange[] = [];
    for (const finding of after) {
        const was = earlier.get(keyOf(finding));
        earlier.delete(keyOf(finding));
        let change: WhereChange['change'] = 'same';
        if (was === undefined) {
            change = 'new';
        } else if (finding.measured > was.measured) {
            change = 'worse';
        }
        changes.push(changeOf(finding, change, was?.measured, finding.measured, path));
    }
    for (const gone of earlier.values()) {
        changes.push(changeOf(gone, 'fixed', gone.measured, undefined, path));
    }
    return changes.toSorted(
        (a, b) =>
            compareText(a.folder, b.folder) || compareText(a.rule, b.rule) || compareText(a.key ?? '', b.key ?? ''),
    );
}

function changeOf(
    finding: Finding,
    change: WhereChange['change'],
    before: number | undefined,
    after: number | undefined,
    path: string,
): WhereChange {
    return {
        change,
        rule: finding.rule,
        severity: finding.severity,
        folder: finding.folder,
        key: finding.key,
        before,
        after,
        limit: finding.limit,
        message: finding.message,
        moves: finding.moves.filter(move => move.from === path),
    };
}

function effectOf(changes: readonly WhereChange[]): WhereEffect {
    if (changes.some(change => change.change === 'new')) {
        return 'creates';
    }
    if (changes.some(change => change.change === 'worse')) {
        return 'worsens';
    }
    return changes.some(change => change.change === 'fixed') ? 'fixes' : 'neutral';
}

/**
 * Where the file could go: the subfolders of its folder named after the words its name starts with
 * (`navbar-mobile.component.ts` and `navbar/`), where the rule that complains would put it, and the
 * modules it would sit with (a group that is not yet one folder's worth).
 */
function placesFor(
    input: WhereInput,
    withFile: readonly string[],
    changes: readonly WhereChange[],
): { candidates: WhereCandidate[]; group?: WhereGroup } {
    const { path } = input;
    const candidates: WhereCandidate[] = [];
    const named: WhereCandidate[] = [];
    const proposed = new Set<string>();
    for (const change of changes) {
        if (change.change === 'fixed') {
            continue;
        }
        for (const move of change.moves) {
            const to = parentOf(move.to);
            if (proposed.has(to)) {
                continue;
            }
            proposed.add(to);
            candidates.push({
                folder: to,
                kind: 'move',
                reason: `${change.rule} would put it there${change.key === undefined ? '' : ` (the group "${change.key}")`}`,
            });
        }
    }

    const explanation = explainFolder({ files: withFile, config: input.config, rules: input.rules }, parentOf(path));
    const name = baseName(path);
    const module = explanation?.folder.modules.find(candidate => candidate.files.includes(name));
    if (!explanation || !module) {
        return { candidates };
    }
    const { folder: view, rules } = explanation;
    const routes = view.naming.routes === true;
    for (let size = Math.min(module.subject.length, MAX_KEY_WORDS); size >= 1; size--) {
        const words = module.subject.slice(0, size);
        const written = folderNameFor(words, view.naming).name;
        const there = written === undefined ? undefined : existingFolder(written, view.folders, routes);
        const folder = there === undefined ? undefined : joinPath(view.path, there);
        if (folder === undefined || proposed.has(folder)) {
            continue;
        }
        proposed.add(folder);
        named.push({
            folder,
            kind: 'folder',
            reason: `${folder}/ exists and is named after "${words.join('-')}", how the file name starts`,
        });
    }

    candidates.unshift(...named);
    const prefix = rules['prefix-groups'];
    if (prefix === undefined || prefix.severity === 'off') {
        return { candidates };
    }
    const words = prefix.effectiveOptions['words'];
    const min = prefix.effectiveOptions['min'];
    if (typeof min !== 'number') {
        return { candidates };
    }
    const grouped = groupModules(
        view.modules,
        words === 'auto' || typeof words === 'number' ? words : 1,
        min,
        view.naming,
    );
    for (const [key, members] of grouped) {
        if (members.includes(module) && members.length >= 2) {
            return {
                candidates,
                group: {
                    key,
                    modules: members
                        .filter(other => other !== module)
                        .map(shownName)
                        .toSorted(compareText),
                    min,
                },
            };
        }
    }
    return { candidates };
}

/** The verdict in a few words, as `WORSE max-files 14→15`: what a person or an agent reads first. */
export function whereSummary(result: WhereResult): string {
    const problems = result.changes
        .filter(change => change.change === 'new' || change.change === 'worse')
        .map(change => `${change.rule}${change.key === undefined ? '' : ` "${change.key}"`} ${measuredOf(change)}`);
    switch (result.effect) {
        case 'creates': {
            return `CREATES ${problems.join(', ')}`;
        }
        case 'worsens': {
            return `WORSE ${problems.join(', ')}`;
        }
        case 'fixes': {
            return 'BETTER it fixes a problem of the folder';
        }
        case 'exists': {
            return 'EXISTS the file is already there';
        }
        case 'unchecked': {
            return `UNCHECKED ${result.note ?? 'no rule looks at it'}`;
        }
        case 'neutral': {
            const exists = result.candidates.find(candidate => candidate.kind === 'folder');
            return exists ? `OK, and ${exists.folder}/ exists` : 'OK';
        }
    }
}

function measuredOf(change: WhereChange): string {
    const limit = change.limit === undefined ? '' : ` (limit ${change.limit})`;
    return change.before === undefined
        ? `${change.after ?? 0}${limit}`
        : `${change.before}→${change.after ?? 0}${limit}`;
}

/** The lines that explain a verdict: each problem, where else the file could go, and the group it joins. */
export function whereDetails(result: WhereResult): string[] {
    const lines: string[] = [];
    for (const change of result.changes) {
        if (change.change === 'new' || change.change === 'worse') {
            lines.push(`${change.rule} in ${change.folder === '.' ? '.' : `${change.folder}/`}: ${change.message}`);
        }
    }
    for (const candidate of result.candidates) {
        if (candidate.kind !== 'folder' || result.effect !== 'neutral') {
            lines.push(`${candidate.folder}/: ${candidate.reason}`);
        }
    }
    for (const change of result.changes) {
        for (const move of change.moves) {
            lines.push(`Move: git mv ${move.from} ${move.to}`);
        }
    }
    if (result.group) {
        const { key, modules, min } = result.group;
        lines.push(
            `It joins the group "${key}-*" with ${modules.length === 1 ? 'one module' : `${modules.length} modules`} (${modules.slice(0, 5).join(', ')}${modules.length > 5 ? ', ...' : ''}); prefix-groups asks for a folder at ${min}`,
        );
    }
    return lines;
}
