import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { parseJsonc } from '../core/config/jsonc.ts';
import { baseName, joinPath, normalisePath, parentOf } from '../core/paths/tree.ts';
import { plural, shownOf } from '../core/plural.ts';
import {
    DEFAULT_SUPPRESSIONS,
    parseSuppressions,
    PER_PROJECT,
    projectOf,
    serialiseSuppressions,
    type Suppression,
    type SuppressionChange,
    type SuppressionEdit,
} from '../core/suppressions.ts';
import { UsageError } from './args.ts';
import { type Io, writeFileAtomic } from './io.ts';

/** One suppressions file: where it is, and the folder its keys are relative to. */
interface StoreFile {
    readonly absolute: string;
    /** Its path relative to the root (as given, when it is outside): what messages and `Suppression.file` say. */
    readonly label: string;
    /** The folder its keys are relative to, relative to the root. */
    readonly base: string;
}

/**
 * Where the suppressions of a run are read from and written to: one file for the repository (the
 * default, or the one `--suppressions-location` or `"suppressions"` name), or with `"per-project"`
 * one `crowded-folders-suppressions.json` per project, its keys relative to the project.
 */
export class SuppressionStore {
    readonly perProject: boolean;
    private readonly root: string;
    private readonly known = new Map<string, StoreFile>();
    private readonly repositoryFiles: ReadonlySet<string>;
    private readonly single: StoreFile | undefined;

    constructor(root: string, location: string, files: readonly string[]) {
        this.root = root;
        this.perProject = location === PER_PROJECT;
        this.repositoryFiles = new Set(files);
        if (this.perProject) {
            for (const path of files) {
                if (baseName(path) === DEFAULT_SUPPRESSIONS) {
                    this.fileAt(path);
                }
            }
            this.single = undefined;
        } else {
            const absolute = resolve(root, location);
            const inside = relative(root, absolute);
            const label =
                inside.startsWith('..') || isAbsolute(inside) ? absolute : (normalisePath(inside) ?? location);
            this.single = { absolute, label, base: '.' };
            this.known.set(label, this.single);
        }
    }

    /** The files of the repository that are suppressions files: they are never checked as files. */
    ownFiles(): string[] {
        return [...this.known.values()].filter(file => !isAbsolute(file.label)).map(file => file.label);
    }

    /** The file a new suppression of `folder` goes to. */
    readonly fileFor = (folder: string): string => {
        return this.single
            ? this.single.label
            : this.fileAt(joinPath(projectOf(folder, this.repositoryFiles), DEFAULT_SUPPRESSIONS)).label;
    };

    read(): Suppression[] {
        const all: Suppression[] = [];
        const holder = new Map<string, string>();
        for (const file of this.known.values()) {
            if (!existsSync(file.absolute)) {
                continue;
            }
            let value: unknown;
            try {
                value = parseJsonc(readFileSync(file.absolute, 'utf8'));
            } catch (error) {
                throw new UsageError(`${file.label} is not valid JSON: ${(error as Error).message}`);
            }
            const parsed = parseSuppressions(value, { file: file.label, base: file.base });
            if (typeof parsed === 'string') {
                throw new UsageError(`${file.label} ${parsed}`);
            }
            for (const entry of parsed) {
                const key = `${entry.folder}\0${entry.id}`;
                const other = holder.get(key);
                if (other !== undefined) {
                    throw new UsageError(
                        `${entry.folder} → ${entry.id} is suppressed in both ${other} and ${file.label}: keep it in one`,
                    );
                }
                holder.set(key, file.label);
                all.push(entry);
            }
        }
        return all;
    }

    /**
     * Writes the files an edit changed, and says what it wrote: a file nobody reads in a diff is a
     * file nobody reviews. A file the edit did not change is not touched. Returns the files written.
     */
    write(edit: SuppressionEdit, io: Io, verb: 'add' | 'prune'): string[] {
        const changed = new Set(edit.changes.map(change => change.file));
        if (changed.size === 0) {
            const file = this.single?.label ?? `the ${DEFAULT_SUPPRESSIONS} files`;
            io.error(
                verb === 'add'
                    ? `Nothing to suppress: there are no errors, so ${file} was not written.\n`
                    : `Nothing to prune: ${file} is up to date.\n`,
            );
            return [];
        }
        const written: string[] = [];
        for (const label of [...changed].toSorted((a, b) => a.localeCompare(b))) {
            const file = this.known.get(label);
            if (!file) {
                continue;
            }
            const entries = edit.suppressions.filter(entry => entry.file === label);
            writeFileAtomic(file.absolute, serialiseSuppressions(entries, file.base));
            written.push(file.absolute);
            const changes = edit.changes.filter(change => change.file === label);
            io.error(describe(label, entries, changes, verb));
        }
        return written;
    }

    /** The file a `Suppression.file` names: where it is, and the folder its keys start at. */
    readonly locate = (label: string): { readonly absolute: string; readonly base: string } | undefined => {
        return this.known.get(label);
    };

    private fileAt(label: string): StoreFile {
        const existing = this.known.get(label);
        if (existing) {
            return existing;
        }
        const file = { absolute: resolve(this.root, label), label, base: parentOf(label) };
        this.known.set(label, file);
        return file;
    }
}

const SHOWN = 20;

function describe(
    label: string,
    entries: readonly Suppression[],
    changes: readonly SuppressionChange[],
    verb: 'add' | 'prune',
): string {
    const counts = (['added', 'raised', 'lowered', 'removed'] as const)
        .map(kind => [kind, changes.filter(change => change.kind === kind).length] as const)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${kind} ${count}`);
    const folders = new Set(entries.map(entry => entry.folder)).size;
    const now = `it holds ${plural(entries.length, 'suppression')} in ${plural(folders, 'folder')}`;
    const lines = [`${verb === 'add' ? 'Wrote' : 'Pruned'} ${label}: ${counts.join(', ')}; ${now}. Commit it.`];
    const shown = shownOf(changes.length, SHOWN);
    for (const change of changes.slice(0, shown)) {
        lines.push(`  ${lineOf(change)}`);
    }
    if (changes.length > shown) {
        lines.push(`  … and ${changes.length - shown} more: the diff of ${label} has them all.`);
    }
    return `${lines.join('\n')}\n`;
}

function lineOf(change: SuppressionChange): string {
    const where = `${change.folder}  ${change.id}`;
    switch (change.kind) {
        case 'added': {
            return `+ ${where}  at ${change.to ?? 0}`;
        }
        case 'raised': {
            return `↑ ${where}  ${change.from ?? 0} → ${change.to ?? 0}`;
        }
        case 'lowered': {
            return `↓ ${where}  ${change.from ?? 0} → ${change.to ?? 0}`;
        }
        default: {
            return `− ${where}  (was ${change.from ?? 0})`;
        }
    }
}
