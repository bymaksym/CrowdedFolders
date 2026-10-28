import { plural, shownOf } from '../core/plural.ts';
import {
    DEFAULT_SUPPRESSIONS,
    serialiseSuppressions,
    type Suppression,
    type SuppressionChange,
    type SuppressionEdit,
} from '../core/suppressions.ts';
import { SuppressionFiles, SuppressionsFileError } from '../node/suppressions-files.ts';
import { UsageError } from './args.ts';
import { type Io, writeFileAtomic } from './io.ts';

/**
 * The suppressions files of a run, as `lint()` reads them (`SuppressionFiles`), and written by
 * `--suppress-all`, `--suppress-rule` and `--prune-suppressions`. A file that cannot be read is a
 * mistake in the input, exit code 2.
 */
export class SuppressionStore extends SuppressionFiles {
    override read(): Suppression[] {
        try {
            return super.read();
        } catch (error) {
            throw error instanceof SuppressionsFileError ? new UsageError(error.message) : error;
        }
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
