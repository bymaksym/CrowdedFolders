import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// How every path of a run is compared: as its real path, so that a Windows short name (`MAKSYM~1.OST`),
// a junction, a different case of a drive letter or macOS's `/var` → `/private/var` is one folder.
// A module of its own: the ESLint plugin needs it without loading what reads a configuration.

/**
 * The real path of a path that need not exist: its deepest part that exists as its real path, and the
 * rest as written. A file about to be added under a junction or a short name is in the real folder.
 */
export function realPathOfAny(path: string): string {
    const rest: string[] = [];
    let existing = path;
    while (!existsSync(existing)) {
        const parent = dirname(existing);
        if (parent === existing) {
            return path;
        }
        rest.unshift(basename(existing));
        existing = parent;
    }
    return rest.length === 0 ? realPath(existing) : join(realPath(existing), ...rest);
}

/** The real path of something that exists (the long, correctly cased form); the path itself otherwise. */
export function realPath(path: string): string {
    try {
        return realpathSync.native(path);
    } catch {
        return path;
    }
}
