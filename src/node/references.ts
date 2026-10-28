import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Larger files are not read: a lockfile or a bundle names everything and is regenerated anyway. */
const MAX_BYTES = 1024 * 1024;

/** What a file has to have at a name's edge for the name to be whole: not a letter, digit, `_` or `-`. */
function isNameChar(char: string | undefined): boolean {
    return char !== undefined && /[\p{L}\p{N}_-]/u.test(char);
}

/**
 * The tracked files whose text names one of the paths of each group, for `--moves`: a move breaks a
 * `package.json` script, a `knip.jsonc` entry or an import that names the old path. A plain search
 * of the names, not a parser — enough to say where to look, and cheap enough to run only when the
 * moves are asked for. A name counts when it is whole: the file name (`validate-i18n.mjs`), or the
 * path without its extension after a `/` (`./render-json'`, as imports write it). Binary files and
 * files over 1 MiB are skipped; a file is never counted for naming itself.
 */
export function filesNaming(
    root: string,
    files: readonly string[],
    groups: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
    const found = new Map<string, string[]>([...groups.keys()].map(key => [key, []]));
    if (groups.size === 0) {
        return found;
    }
    const needles = new Map([...groups].map(([key, paths]) => [key, paths.flatMap(path => needlesOf(path))]));
    for (const file of files) {
        const text = readText(join(root, file));
        if (text === undefined) {
            continue;
        }
        for (const [key, list] of needles) {
            if (list.some(needle => needle.path !== file && contains(text, needle))) {
                found.get(key)?.push(file);
            }
        }
    }
    return found;
}

interface Needle {
    readonly path: string;
    readonly text: string;
    /** Whether only a `/` may come before it (a path without its extension); else any non-name character. */
    readonly afterSlash: boolean;
}

function needlesOf(path: string): Needle[] {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const needles: Needle[] = [{ path, text: name, afterSlash: false }];
    if (dot > 0) {
        needles.push({ path, text: `/${name.slice(0, dot)}`, afterSlash: true });
    }
    return needles;
}

function contains(text: string, needle: Needle): boolean {
    for (let at = text.indexOf(needle.text); at !== -1; at = text.indexOf(needle.text, at + 1)) {
        const before = text[at - 1];
        const after = text[at + needle.text.length];
        if ((needle.afterSlash || !isNameChar(before)) && !isNameChar(after) && after !== '/') {
            return true;
        }
    }
    return false;
}

/** The file as text, or `undefined` when it is missing, too large or binary (a NUL in its first 8 KiB). */
function readText(path: string): string | undefined {
    try {
        const { size } = statSync(path);
        if (size > MAX_BYTES || size === 0) {
            return undefined;
        }
        const buffer = readFileSync(path);
        return buffer.subarray(0, 8192).includes(0) ? undefined : buffer.toString('utf8');
    } catch {
        // Listed but not on the disk (--stdin, a sparse checkout): nothing to search.
        return undefined;
    }
}
