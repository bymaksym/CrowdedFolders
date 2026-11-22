import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { normalisePath } from '../core/paths/tree.ts';
import { shownPath } from '../node/config/error.ts';
import { realPath } from '../node/config/real-path.ts';
import { joinScope, type Session, within } from './session.ts';
import { UsageError } from './usage-error.ts';

/**
 * Turns the paths of files to be added (relative to where the command was typed, or absolute) into
 * paths of the report. Unlike `foldersFromPaths` they need not exist: that is the question. A folder
 * (it exists as one, or the path ends in a separator) is not a file to add.
 */
export function newFilesFromPaths(paths: readonly string[], session: Session, cwd: string): string[] {
    const here = realPath(cwd);
    return paths.map(path => {
        const lexical = resolve(here, path);
        if (/[/\\]$/u.test(path) || (existsSync(lexical) && statSync(lexical).isDirectory())) {
            throw new UsageError(
                `${path} is a folder: give the path of the file to add, as in ${path.replace(/[/\\]+$/u, '')}/new-file.ts`,
            );
        }
        // The folder is resolved on the disk when it exists (a symlink, another case on Windows), the name is kept.
        const folder = dirname(lexical);
        const real = existsSync(folder) ? join(realPath(folder), basename(lexical)) : lexical;
        const inRoot = within(session.root, real) ?? within(session.root, lexical);
        const normalised = inRoot === undefined ? undefined : normalisePath(inRoot);
        if (normalised === undefined) {
            throw new UsageError(`${path} is outside the folder being checked (${shownPath(here, session.root)})`);
        }
        return joinScope(session.scope, normalised);
    });
}
