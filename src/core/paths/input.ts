import { shownOf } from '../plural.ts';
import { normalisePath } from './tree.ts';

/** A path of a file list that is not a file of the root, and why. */
export interface PathProblem {
    readonly path: string;
    readonly problem: string;
}

/** A file list with paths that cannot be read as files of the root: every one of them, never a guess. */
export class FileListError extends Error {
    readonly problems: readonly PathProblem[];

    constructor(problems: readonly PathProblem[]) {
        const shown = problems
            .slice(0, shownOf(problems.length, 10))
            .map(({ path, problem }) => `  ${path}: ${problem}`);
        const more = problems.length > shown.length ? [`  and ${problems.length - shown.length} more`] : [];
        super(
            `${problems.length === 1 ? 'a path' : `${problems.length} paths`} of the file list cannot be read as files of the root:\n${[...shown, ...more].join('\n')}`,
        );
        this.name = 'FileListError';
        this.problems = problems;
    }
}

/** Whether a path is absolute on some system: `/x`, `\\server\share`, `C:\x` or `C:/x`. */
export function isAbsolutePath(path: string): boolean {
    if (path.startsWith('/') || path.startsWith('\\')) {
        return true;
    }
    const drive = path.codePointAt(0) ?? 0;
    const isLetter = (drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122);
    return isLetter && path[1] === ':' && (path[2] === '/' || path[2] === '\\');
}

/**
 * Reads the paths of a file list as files of the root, the same way for the command line and for
 * `lint({ files })`: `/` separators, no `./`, each path once. An absolute path under `root` is made
 * relative to it; an absolute path elsewhere, or one that climbs out with `..`, is a problem — never
 * a folder named `C:` or `home` inside the root. Empty lines are skipped.
 *
 * `root` is the root as an absolute path, with either separator; without it, every absolute path is
 * a problem. A root with a drive letter or a `\\server` prefix is compared without case, as Windows does.
 */
export function normaliseFileList(
    paths: Iterable<string>,
    root?: string,
): { readonly files: string[]; readonly problems: PathProblem[] } {
    const files = new Set<string>();
    const problems: PathProblem[] = [];
    const base = root === undefined ? undefined : trimEnd(root.replaceAll('\\', '/'));
    const isCaseless = base !== undefined && (base.startsWith('//') || base[1] === ':');
    for (const path of paths) {
        if (isNormal(path)) {
            files.add(path);
            continue;
        }
        let relative = path;
        if (isAbsolutePath(path)) {
            const slashed = path.replaceAll('\\', '/');
            const compared = isCaseless ? slashed.toLowerCase() : slashed;
            const prefix = base === undefined ? undefined : `${isCaseless ? base.toLowerCase() : base}/`;
            if (prefix === undefined || !compared.startsWith(prefix)) {
                problems.push({
                    path,
                    problem:
                        root === undefined
                            ? 'is absolute: give paths relative to the root'
                            : `is absolute and not under the root (${root})`,
                });
                continue;
            }
            relative = slashed.slice(prefix.length);
        }
        const normalised = normalisePath(relative);
        if (normalised !== undefined) {
            files.add(normalised);
        } else if (relative.replaceAll('\\', '/').split('/').includes('..')) {
            problems.push({ path, problem: 'climbs out of the root with ".."' });
        }
    }
    return { files: [...files], problems };
}

/** A path already written the way the engine reads it, which is nearly every path: nothing to do. */
function isNormal(path: string): boolean {
    return (
        path !== '' &&
        path !== '.' &&
        path !== '..' &&
        path[1] !== ':' &&
        !path.includes('\\') &&
        !path.startsWith('/') &&
        !path.endsWith('/') &&
        !path.startsWith('./') &&
        !path.startsWith('../') &&
        !path.endsWith('/.') &&
        !path.endsWith('/..') &&
        !path.includes('//') &&
        !path.includes('/./') &&
        !path.includes('/../')
    );
}

function trimEnd(path: string): string {
    let end = path.length;
    while (end > 0 && path[end - 1] === '/') end--;
    return path.slice(0, end);
}
