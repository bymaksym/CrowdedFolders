import { isObject } from './config/json-schema.ts';
import type { Finding } from './engine.ts';
import { compareText } from './naming/modules.ts';
import { joinPath, normalisePath, parentOf } from './paths/tree.ts';

/**
 * The problems a repository already had when it adopted the tool, so it can start failing only on
 * new ones. The same idea, file and flags as ESLint's bulk suppressions.
 *
 * Each entry remembers the number that was measured. It may stay or go down; it may not go up. A
 * suppression nothing needs any more — fixed, or lower than it remembers — fails the run until it
 * is pruned, so the file only ever shrinks: a ceiling that only comes down.
 *
 * Folder names come from the repository, so they are never used as property names: `__proto__` and
 * `constructor` are folders like any other. Everything here is keyed by `Map`.
 */

export const DEFAULT_SUPPRESSIONS = 'crowded-folders-suppressions.json';

/** The `suppressions` setting that keeps one file per project instead of one for the repository. */
export const PER_PROJECT = 'per-project';

/**
 * What makes a folder a project for `"suppressions": "per-project"`: the manifest of a package,
 * module or build. The nearest one above a folder (or an existing suppressions file) decides
 * which file holds the folder's suppressions.
 */
export const PROJECT_MANIFESTS = [
    'package.json',
    'project.json',
    'go.mod',
    'Cargo.toml',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'pyproject.toml',
    'composer.json',
    'pubspec.yaml',
    'mix.exs',
    'BUILD.bazel',
] as const;

/** The fields a person may write next to `count`. The tool keeps them as written and never acts on them. */
const NOTES = ['reason', 'owner', 'expires'] as const;

export interface SuppressionNotes {
    /** Why it is accepted for now. */
    readonly reason?: string;
    /** Who will bring it down. */
    readonly owner?: string;
    /** When it should be gone, `YYYY-MM-DD`. */
    readonly expires?: string;
}

/** One suppression: a problem in a folder, and the number measured when it was accepted. */
export interface Suppression extends SuppressionNotes {
    /** The folder, relative to the root; the root is `.`. */
    readonly folder: string;
    /** `rule`, or `rule#key` for a problem with a key. */
    readonly id: string;
    readonly count: number;
    /** The suppressions file that holds it, relative to the root. */
    readonly file: string;
}

export type StaleStatus =
    /** The problem is gone. */
    | 'fixed'
    /** The problem is smaller than remembered: progress, still to be saved. */
    | 'lowered'
    /** The folder is gone and a new problem of the same rule looks like it, elsewhere. */
    | 'moved'
    /** The rule of the id is not a rule. */
    | 'unknown-rule'
    /** No checked file is in the folder. */
    | 'missing-folder';

/** A suppression the run says must be pruned. */
export interface StaleSuppression {
    readonly folder: string;
    readonly id: string;
    readonly rule: string;
    readonly key: string | undefined;
    readonly count: number;
    /** What is measured today; `undefined` when the problem is gone. */
    readonly measured: number | undefined;
    readonly status: StaleStatus;
    /** For `moved`: the folder where the problem looks to be now. */
    readonly movedTo?: string;
    /** For `missing-folder`: a folder that differs only in case. */
    readonly didYouMean?: string;
    /** The suppressions file that holds it, relative to the root. */
    readonly file: string;
}

export interface SuppressionOutcome {
    readonly kept: readonly Finding[];
    readonly suppressed: readonly Finding[];
    readonly stale: readonly StaleSuppression[];
}

/** What a run knows that a suppression is checked against. */
export interface SuppressionContext {
    /** Whether a folder holds a checked file (or is above one). Asked only about suppressions nothing used. */
    readonly folderExists: (folder: string) => boolean;
    /** The folders that exist, for a case-insensitive "did you mean"; asked as rarely as `folderExists`. */
    readonly folders?: () => Iterable<string>;
    /** Every rule that can be named. */
    readonly rules: ReadonlySet<string>;
    /**
     * Only the suppressions of folders this accepts are looked at; the others are left as they are,
     * neither used nor stale. A run over some folders says nothing about the rest. Default: all.
     */
    readonly inScope?: (folder: string) => boolean;
    /** Folders whose files went elsewhere, old → new, when the run compared with a base. */
    readonly renamed?: ReadonlyMap<string, string>;
}

/** One line of what `--suppress-all`, `--suppress-rule` or `--prune-suppressions` changed. */
export interface SuppressionChange {
    readonly kind: 'added' | 'raised' | 'lowered' | 'removed';
    readonly folder: string;
    readonly id: string;
    /** The count before; `undefined` for an added one. */
    readonly from: number | undefined;
    /** The count after; `undefined` for a removed one. */
    readonly to: number | undefined;
    readonly file: string;
}

export interface SuppressionEdit {
    readonly suppressions: readonly Suppression[];
    readonly changes: readonly SuppressionChange[];
}

export function suppressionId(finding: Pick<Finding, 'key' | 'rule'>): string {
    return finding.key === undefined ? finding.rule : `${finding.rule}#${finding.key}`;
}

function ruleOf(id: string): { rule: string; key: string | undefined } {
    const hash = id.indexOf('#');
    return hash === -1 ? { rule: id, key: undefined } : { rule: id.slice(0, hash), key: id.slice(hash + 1) };
}

const keyOf = (folder: string, id: string): string => `${folder}\0${id}`;

/** Splits findings into the ones still reported and the ones a suppression covers, and says which suppressions are stale. */
export function applySuppressions(
    findings: readonly Finding[],
    suppressions: readonly Suppression[],
    context: SuppressionContext,
): SuppressionOutcome {
    const inScope = context.inScope ?? ((): boolean => true);
    const index = new Map<string, Suppression>();
    for (const suppression of suppressions) {
        if (inScope(suppression.folder)) {
            index.set(keyOf(suppression.folder, suppression.id), suppression);
        }
    }
    const kept: Finding[] = [];
    const suppressed: Finding[] = [];
    const used = new Set<string>();
    const stale: StaleSuppression[] = [];
    /** Findings no suppression covers: where a suppression of a folder that is gone may have moved. */
    const unclaimed: Finding[] = [];
    for (const finding of findings) {
        const id = suppressionId(finding);
        const entry = finding.rule.startsWith('config/') ? undefined : index.get(keyOf(finding.folder, id));
        if (!entry) {
            kept.push(finding);
            if (!finding.rule.startsWith('config/')) {
                unclaimed.push(finding);
            }
            continue;
        }
        used.add(keyOf(finding.folder, id));
        if (finding.measured > entry.count) {
            kept.push({ ...finding, message: `${finding.message} (Suppressed at ${entry.count}; it has grown.)` });
            continue;
        }
        suppressed.push(finding);
        if (finding.measured < entry.count) {
            stale.push(staleOf(entry, finding.measured, 'lowered'));
        }
    }

    const moved = new Map<Finding, Suppression>();
    for (const [key, entry] of index) {
        if (used.has(key)) {
            continue;
        }
        const { rule } = ruleOf(entry.id);
        if (!context.rules.has(rule)) {
            stale.push(staleOf(entry, undefined, 'unknown-rule'));
            continue;
        }
        const target = movedTarget(entry, unclaimed, moved, context);
        if (target) {
            moved.set(target, entry);
            stale.push({ ...staleOf(entry, undefined, 'moved'), movedTo: target.folder });
            continue;
        }
        if (!context.folderExists(entry.folder)) {
            const lower = entry.folder.toLowerCase();
            let didYouMean: string | undefined;
            for (const folder of context.folders?.() ?? []) {
                if (folder.toLowerCase() === lower) {
                    didYouMean = folder;
                    break;
                }
            }
            stale.push({ ...staleOf(entry, undefined, 'missing-folder'), ...(didYouMean && { didYouMean }) });
            continue;
        }
        stale.push(staleOf(entry, undefined, 'fixed'));
    }

    return {
        kept: kept.map(finding => {
            const from = moved.get(finding);
            return from
                ? {
                      ...finding,
                      message: `${finding.message} (Looks moved from ${from.folder}, where it was suppressed at ${from.count}.)`,
                  }
                : finding;
        }),
        suppressed,
        stale: stale.toSorted((a, b) => compareText(a.folder, b.folder) || compareText(a.id, b.id)),
    };
}

/**
 * The new finding a suppression of a folder that is gone looks moved to: the same rule and key in the
 * folder its files went to, or, without that evidence, the only new finding of the same rule, key and
 * number. A suggestion, never applied: the suppression is not carried over by itself.
 */
function movedTarget(
    entry: Suppression,
    unclaimed: readonly Finding[],
    taken: ReadonlyMap<Finding, Suppression>,
    context: SuppressionContext,
): Finding | undefined {
    const candidates = unclaimed.filter(finding => !taken.has(finding) && suppressionId(finding) === entry.id);
    const renamedTo = context.renamed?.get(entry.folder);
    if (renamedTo !== undefined) {
        const found = candidates.find(finding => finding.folder === renamedTo);
        if (found) {
            return found;
        }
    }
    if (context.folderExists(entry.folder)) {
        return undefined;
    }
    const same = candidates.filter(finding => finding.measured === entry.count);
    return same.length === 1 ? same[0] : undefined;
}

function staleOf(entry: Suppression, measured: number | undefined, status: StaleStatus): StaleSuppression {
    return {
        folder: entry.folder,
        id: entry.id,
        ...ruleOf(entry.id),
        count: entry.count,
        measured,
        status,
        file: entry.file,
    };
}

/**
 * Adds a suppression for every error-level finding (optionally only some rules), the way
 * `--suppress-all` and `--suppress-rule` do. Warnings never fail a run, so they are not kept. An
 * existing suppression keeps its notes and is raised to what is measured.
 */
export function addSuppressions(
    existing: readonly Suppression[],
    findings: readonly Finding[],
    options: { readonly rules?: readonly string[]; readonly fileFor: (folder: string) => string },
): SuppressionEdit {
    const result = new Map<string, Suppression>(existing.map(entry => [keyOf(entry.folder, entry.id), entry]));
    const changes: SuppressionChange[] = [];
    for (const finding of findings) {
        if (
            finding.severity !== 'error' ||
            finding.rule.startsWith('config/') ||
            (options.rules && !options.rules.includes(finding.rule))
        ) {
            continue;
        }
        const id = suppressionId(finding);
        const key = keyOf(finding.folder, id);
        const before = result.get(key);
        if (before === undefined) {
            const file = options.fileFor(finding.folder);
            result.set(key, { folder: finding.folder, id, count: finding.measured, file });
            changes.push({ kind: 'added', folder: finding.folder, id, from: undefined, to: finding.measured, file });
        } else if (finding.measured > before.count) {
            result.set(key, { ...before, count: finding.measured });
            changes.push({
                kind: 'raised',
                folder: finding.folder,
                id,
                from: before.count,
                to: finding.measured,
                file: before.file,
            });
        }
    }
    return { suppressions: sorted([...result.values()]), changes: sortedChanges(changes) };
}

/**
 * Removes what nothing needs and lowers what went down: `--prune-suppressions`. Only the
 * suppressions in scope are looked at: a run over some folders leaves the others as they are.
 */
export function pruneSuppressions(
    existing: readonly Suppression[],
    findings: readonly Finding[],
    options: { readonly inScope?: (folder: string) => boolean } = {},
): SuppressionEdit {
    const inScope = options.inScope ?? ((): boolean => true);
    const measured = new Map<string, number>();
    for (const finding of findings) {
        measured.set(keyOf(finding.folder, suppressionId(finding)), finding.measured);
    }
    const result: Suppression[] = [];
    const changes: SuppressionChange[] = [];
    for (const entry of existing) {
        if (!inScope(entry.folder)) {
            result.push(entry);
            continue;
        }
        const now = measured.get(keyOf(entry.folder, entry.id));
        const base = { folder: entry.folder, id: entry.id, from: entry.count, file: entry.file };
        if (now === undefined) {
            changes.push({ ...base, kind: 'removed', to: undefined });
        } else if (now < entry.count) {
            result.push({ ...entry, count: now });
            changes.push({ ...base, kind: 'lowered', to: now });
        } else {
            result.push(entry);
        }
    }
    return { suppressions: sorted(result), changes: sortedChanges(changes) };
}

/**
 * Reads a suppressions file that came from disk; the message says what is wrong with it.
 *
 * `base` is the folder its keys are relative to (`.` for the repository's file), and `file` its path,
 * both relative to the root. Keys are normalised (`src/lib/`, `./src/lib` and `src\lib` are
 * `src/lib`), so a trailing slash does not turn a suppression into one of a folder that never exists.
 */
export function parseSuppressions(
    value: unknown,
    where: { readonly file: string; readonly base: string },
): Suppression[] | string {
    if (!isObject(value) || value['version'] !== 1 || !isObject(value['suppressions'])) {
        return 'is not a crowded-folders suppressions file (it needs "version": 1 and "suppressions")';
    }
    const seen = new Map<string, string>();
    const result: Suppression[] = [];
    for (const [written, entries] of Object.entries(value['suppressions'])) {
        if (!isObject(entries)) {
            return `has a folder "${written}" that is not an object`;
        }
        const relative = normaliseKey(written);
        if (relative === undefined) {
            return `has a folder "${written}" that is outside the folder it belongs to`;
        }
        const folder = relative === '.' ? where.base : joinPath(where.base, relative);
        for (const [id, entry] of Object.entries(entries)) {
            const problem = entryProblem(entry);
            if (problem !== undefined) {
                return `has "${written}" → "${id}" ${problem}`;
            }
            const key = keyOf(folder, id);
            const before = seen.get(key);
            if (before !== undefined) {
                return `has "${id}" twice for one folder, as "${before}" and "${written}": keep one`;
            }
            seen.set(key, written);
            const fields = entry as Readonly<Record<string, unknown>>;
            const notes: Record<string, string> = {};
            for (const note of NOTES) {
                const text = fields[note];
                if (typeof text === 'string') {
                    notes[note] = text;
                }
            }
            result.push({ folder, id, count: fields['count'] as number, ...notes, file: where.file });
        }
    }
    return sorted(result);
}

/** `src/lib/`, `./src/lib`, `src\lib` → `src/lib`; `.`, `./` and `` → `.`; a key that climbs above → `undefined`. */
function normaliseKey(key: string): string | undefined {
    return key.replaceAll('\\', '/').split('/').includes('..') ? undefined : (normalisePath(key) ?? '.');
}

function entryProblem(entry: unknown): string | undefined {
    if (!isObject(entry)) {
        return 'that is not an object with a "count"';
    }
    const count = entry['count'];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        return 'without a whole "count"';
    }
    for (const [field, text] of Object.entries(entry)) {
        if (field === 'count') {
            continue;
        }
        if (!(NOTES as readonly string[]).includes(field)) {
            return `with "${field}", which is not a field of a suppression (count, ${NOTES.join(', ')})`;
        }
        if (typeof text !== 'string') {
            return `with a "${field}" that is not text`;
        }
    }
    const expires = entry['expires'];
    return typeof expires === 'string' && !/^\d{4}-\d{2}-\d{2}$/u.test(expires)
        ? `with "expires": "${expires}", which is not a date (YYYY-MM-DD)`
        : undefined;
}

/** The suppressions of one file, as it is written: keys relative to `base`, sorted, notes after `count`. */
export function serialiseSuppressions(suppressions: readonly Suppression[], base = '.'): string {
    const byFolder = new Map<string, [string, Record<string, unknown>][]>();
    for (const entry of sorted(suppressions)) {
        const relative = relativeTo(base, entry.folder);
        const entries = byFolder.get(relative) ?? [];
        byFolder.set(relative, entries);
        const fields: [string, unknown][] = [['count', entry.count]];
        for (const note of NOTES) {
            if (entry[note] !== undefined) {
                fields.push([note, entry[note]]);
            }
        }
        entries.push([entry.id, Object.fromEntries(fields)]);
    }
    // Object.fromEntries defines own properties, so a folder called `__proto__` is written as one.
    const folders = [...byFolder]
        .toSorted(([a], [b]) => compareText(a, b))
        .map(([folder, entries]) => [folder, Object.fromEntries(entries)] as const);
    return `${JSON.stringify({ version: 1, suppressions: Object.fromEntries(folders) }, undefined, 2)}\n`;
}

/** `folder` relative to `base`; both relative to the root, which is `.`. */
export function relativeTo(base: string, folder: string): string {
    if (base === '.') {
        return folder;
    }
    return folder === base ? '.' : folder.slice(base.length + 1);
}

/**
 * The folder whose suppressions file holds a folder's suppressions with `"per-project"`: the
 * nearest folder at or above it with a suppressions file or a project manifest, else the root.
 */
export function projectOf(folder: string, files: ReadonlySet<string>): string {
    for (let dir = folder; ; dir = parentOf(dir)) {
        if (
            files.has(joinPath(dir, DEFAULT_SUPPRESSIONS)) ||
            PROJECT_MANIFESTS.some(name => files.has(joinPath(dir, name)))
        ) {
            return dir;
        }
        if (dir === '.') {
            return '.';
        }
    }
}

function sorted(suppressions: readonly Suppression[]): Suppression[] {
    return suppressions.toSorted((a, b) => compareText(a.folder, b.folder) || compareText(a.id, b.id));
}

function sortedChanges(changes: readonly SuppressionChange[]): SuppressionChange[] {
    return changes.toSorted((a, b) => compareText(a.folder, b.folder) || compareText(a.id, b.id));
}
