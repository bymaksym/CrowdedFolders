/**
 * Trees that mirror another one: Maven's `src/test/java` copies `src/main/java` package by package,
 * Jest's `__tests__` sits in the folder it tests, RSpec's `spec/` copies Rails' `app/`. Written
 * `"source => mirror"`, each side a path where `**` stands for the part both share, at the start,
 * at the end or both: `"**\/src/main/java/** => **\/src/test/java/**"`, `"** => **\/__tests__"`,
 * `"app/** => spec/**"`. The sides are read segment by segment, without regular expressions.
 */
export interface Mirror {
    readonly source: MirrorSide;
    readonly mirror: MirrorSide;
    /** As written in the configuration. */
    readonly text: string;
}

interface MirrorSide {
    /** Whether a `**` starts the side: the part before the fixed segments is shared. */
    readonly leading: boolean;
    /** Whether a `**` ends the side: the part after the fixed segments is shared. */
    readonly trailing: boolean;
    readonly fixed: readonly string[];
}

const ARROW = ' => ';

/** Reads a mirror as written, or says why it cannot be read. */
export function parseMirror(text: string): Mirror | string {
    const sides = text.split(ARROW);
    if (sides.length !== 2) {
        return 'is not "source => mirror", with " => " once between the two paths';
    }
    const source = parseSide(sides[0]?.trim() ?? '');
    if (typeof source === 'string') {
        return `source: ${source}`;
    }
    const mirror = parseSide(sides[1]?.trim() ?? '');
    if (typeof mirror === 'string') {
        return `mirror: ${mirror}`;
    }
    if (source.leading !== mirror.leading || source.trailing !== mirror.trailing) {
        return 'the two sides must share the same parts: a "**" at the start of one is at the start of the other, and the same at the end';
    }
    return source.fixed.join('/') === mirror.fixed.join('/')
        ? 'the two sides are the same path'
        : { source, mirror, text };
}

function parseSide(text: string): MirrorSide | string {
    const segments = text.split('/').filter(segment => segment !== '' && segment !== '.');
    if (segments.length === 0) {
        return 'is empty';
    }
    const leading = segments[0] === '**';
    const trailing = segments.length > 1 && segments.at(-1) === '**';
    const fixed = segments.slice(leading ? 1 : 0, trailing ? -1 : undefined);
    for (const segment of fixed) {
        if (segment === '..' || /[*?[\]{}\\]/u.test(segment)) {
            return `"${segment}" is not a folder name: only a "**" at the start or at the end stands for a part of the path`;
        }
    }
    return fixed.length === 0 && trailing ? 'names no folder' : { leading, trailing, fixed };
}

/** The folder that mirrors `path` (`src/test/java/x` for `src/main/java/x`); `undefined` when the mirror does not apply. */
export function mirrorOf(path: string, mirror: Mirror): string | undefined {
    return translate(path, mirror.source, mirror.mirror);
}

/** The folder `path` mirrors (`src/main/java/x` for `src/test/java/x`); `undefined` when the mirror does not apply. */
export function sourceOf(path: string, mirror: Mirror): string | undefined {
    return translate(path, mirror.mirror, mirror.source);
}

function translate(path: string, from: MirrorSide, to: MirrorSide): string | undefined {
    const segments = path === '.' ? [] : path.split('/');
    const at = positionOf(segments, from);
    if (at === undefined) {
        return undefined;
    }
    const joined = [...segments.slice(0, at), ...to.fixed, ...segments.slice(at + from.fixed.length)];
    return joined.length === 0 ? '.' : joined.join('/');
}

/** Where the fixed segments of a side are in a path, as the side allows them to be; the first place. */
function positionOf(segments: readonly string[], side: MirrorSide): number | undefined {
    const { fixed } = side;
    const fits = (at: number): boolean => fixed.every((segment, index) => segments[at + index] === segment);
    const last = segments.length - fixed.length;
    if (last < 0) {
        return undefined;
    }
    if (!side.leading) {
        return fits(0) && (side.trailing || last === 0) ? 0 : undefined;
    }
    if (!side.trailing) {
        return fits(last) ? last : undefined;
    }
    for (let at = 0; at <= last; at++) {
        if (fits(at)) {
            return at;
        }
    }
    return undefined;
}

/** The mirrors that can be read; the configuration has already said what is wrong with the others. */
export function parseMirrors(texts: readonly string[]): Mirror[] {
    return texts.map(text => parseMirror(text)).filter((mirror): mirror is Mirror => typeof mirror !== 'string');
}
