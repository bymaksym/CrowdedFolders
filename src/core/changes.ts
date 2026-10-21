import type { Finding } from './engine.ts';
import { baseName, parentOf } from './paths/tree.ts';

/**
 * What a change did to the shape of a repository, from the file names before and after it. Only
 * names are read, so the base needs no checkout: `git ls-tree -r --name-only <ref>` is enough, also
 * in a clone of depth 1.
 *
 * A file edited in place changes no folder's shape; only a file added, removed or moved does — a
 * move being a removal from one folder and an addition to another, so both folders are touched.
 */
export interface TreeChange {
    /**
     * The folders whose shape changed: a file was added to or removed from them, or a sub-folder of
     * theirs appeared or went.
     */
    readonly touched: ReadonlySet<string>;
    /** Folders whose files went to another folder, old → new: a renamed or moved folder. */
    readonly renamed: ReadonlyMap<string, string>;
    readonly added: number;
    readonly removed: number;
}

export function changeBetween(base: readonly string[], head: readonly string[]): TreeChange {
    const before = new Set(base);
    const after = new Set(head);
    const added = head.filter(path => !before.has(path));
    const removed = base.filter(path => !after.has(path));

    const touched = new Set<string>();
    for (const path of [...added, ...removed]) {
        touched.add(parentOf(path));
    }
    const foldersBefore = foldersOf(base);
    const foldersAfter = foldersOf(head);
    for (const folder of foldersAfter) {
        if (folder !== '.' && !foldersBefore.has(folder)) {
            touched.add(parentOf(folder));
        }
    }
    for (const folder of foldersBefore) {
        if (folder !== '.' && !foldersAfter.has(folder)) {
            touched.add(parentOf(folder));
        }
    }
    return { touched, renamed: renamedFolders(removed, added), added: added.length, removed: removed.length };
}

/** Every folder that holds one of the files, or is above one; the root is `.`. */
export function foldersOf(files: Iterable<string>): Set<string> {
    const folders = new Set<string>(['.']);
    for (const file of files) {
        for (let folder = parentOf(file); folder !== '.' && !folders.has(folder); folder = parentOf(folder)) {
            folders.add(folder);
        }
    }
    return folders;
}

/**
 * Pairs the files removed from a folder with files of the same name added to another: when at least
 * half of what left a folder arrived in one other folder, that folder is where it went.
 */
function renamedFolders(removed: readonly string[], added: readonly string[]): Map<string, string> {
    const addedByName = new Map<string, string[]>();
    for (const path of added) {
        const name = baseName(path);
        const list = addedByName.get(name);
        if (list) {
            list.push(path);
        } else {
            addedByName.set(name, [path]);
        }
    }
    const left = new Map<string, number>();
    const pairs = new Map<string, Map<string, number>>();
    for (const path of removed) {
        const from = parentOf(path);
        left.set(from, (left.get(from) ?? 0) + 1);
        for (const target of addedByName.get(baseName(path)) ?? []) {
            const to = parentOf(target);
            if (to === from) {
                continue;
            }
            const counts = pairs.get(from) ?? new Map<string, number>();
            pairs.set(from, counts);
            counts.set(to, (counts.get(to) ?? 0) + 1);
        }
    }
    const renamed = new Map<string, string>();
    for (const [from, counts] of pairs) {
        let best: string | undefined;
        let bestCount = 0;
        for (const [to, count] of counts) {
            if (count <= bestCount) {
                continue;
            }
            best = to;
            bestCount = count;
        }
        if (best === undefined || bestCount * 2 < (left.get(from) ?? 0)) {
            continue;
        }
        renamed.set(from, best);
    }
    return renamed;
}

export interface BaseComparison {
    /** What is new, or grew, since the base. */
    readonly kept: readonly Finding[];
    /** What the base already had, at the same size or bigger. */
    readonly known: readonly Finding[];
}

/**
 * Splits findings into the ones that are new or grew since the base (`--new-since`) and the ones the
 * base already had. A finding of a folder that was renamed is compared with the old folder's.
 */
export function compareWithBase(
    findings: readonly Finding[],
    base: readonly Finding[],
    options: { readonly label: string; readonly renamed?: ReadonlyMap<string, string> },
): BaseComparison {
    const measured = new Map<string, number>();
    const keyOf = (folder: string, finding: Finding): string => `${folder}\0${finding.rule}\0${finding.key ?? ''}`;
    for (const finding of base) {
        const key = keyOf(finding.folder, finding);
        measured.set(key, Math.max(measured.get(key) ?? 0, finding.measured));
    }
    const formerNames = new Map<string, string[]>();
    for (const [from, to] of options.renamed ?? []) {
        formerNames.set(to, [...(formerNames.get(to) ?? []), from]);
    }
    const kept: Finding[] = [];
    const known: Finding[] = [];
    for (const finding of findings) {
        let before: number | undefined;
        for (const folder of [finding.folder, ...(formerNames.get(finding.folder) ?? [])]) {
            const value = measured.get(keyOf(folder, finding));
            if (value !== undefined) {
                before = Math.max(before ?? 0, value);
            }
        }
        if (before === undefined) {
            kept.push(finding);
        } else if (finding.measured > before) {
            kept.push({ ...finding, message: `${finding.message} (${before} on ${options.label}; it has grown.)` });
        } else {
            known.push(finding);
        }
    }
    return { kept, known };
}
