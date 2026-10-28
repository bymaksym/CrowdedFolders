import { plural } from '../../plural.ts';

/** A file smaller than this many bytes is "tiny": a line or two (`export type Id = string;`). */
export const TINY_BYTES = 200;

/** A folder over its limit whose files are mostly tiny. */
export interface TinyFiles {
    readonly tiny: number;
    /** The files whose size is known. */
    readonly known: number;
    readonly bytes: number;
}

/**
 * Whether most of the files of a folder are tiny, from their sizes alone (`git ls-tree -l`; the core
 * never reads a file). Three files of ten lines are three files; seventy-four of one line are one file
 * that was cut up. A note, never a rule: the size says how big a file is, not what it is.
 */
export function tinyFilesOf(
    files: readonly string[],
    sizes: ReadonlyMap<string, number>,
    bytes: number = TINY_BYTES,
): TinyFiles | undefined {
    let known = 0;
    let tiny = 0;
    for (const file of files) {
        const size = sizes.get(file);
        if (size === undefined) continue;
        known++;
        if (size < bytes) tiny++;
    }
    return tiny >= MOST_AT_LEAST && tiny * 2 > known ? { tiny, known, bytes } : undefined;
}

/** Fewer tiny files than this are not a pattern, whatever the share. */
const MOST_AT_LEAST = 5;

/** "74 of its 92 files are under 200 bytes: maybe they are one file." */
export function describeTiny(found: TinyFiles): string {
    return `${found.tiny} of its ${plural(found.known, 'file')} are under ${found.bytes} bytes: maybe they are one file.`;
}
