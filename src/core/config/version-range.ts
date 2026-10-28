/**
 * Whether a version is in an npm range, for a plugin's `peerDependencies` on crowded-folders: the
 * part of semver ranges that package.json files use — `^1.2.0`, `~1.2`, `>=1 <3`, `1.x`, `1 - 2`,
 * `*`, joined with `||`. Pre-release and build tags are read past, not compared. Written here because
 * the package has no runtime dependency.
 */

type Triple = readonly [number, number, number];

interface Bound {
    readonly version: Triple;
    readonly inclusive: boolean;
}

interface Interval {
    readonly lower?: Bound;
    readonly upper?: Bound;
}

/** `1`, `1.2`, `1.2.3`, with `x`, `X` or `*` for a part, and an optional pre-release or build. */
const PARTIAL = /^v?(\d+|[*Xx])(?:\.(\d+|[*Xx]))?(?:\.(\d+|[*Xx]))?(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u;

/**
 * `true` when `version` is in `range`, `false` when it is not, `undefined` when the range is not
 * one this reads (`workspace:*`, a URL): the caller then says nothing rather than guess.
 */
export function satisfies(version: string, range: string): boolean | undefined {
    const parsed = parsePartial(version);
    if (parsed?.length !== 3) {
        return undefined;
    }
    const triple: Triple = [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0];
    let any = false;
    for (const alternative of range.split('||')) {
        const intervals = intervalsOf(alternative.trim());
        if (intervals === undefined) {
            return undefined;
        }
        if (intervals.every(interval => isWithin(triple, interval))) {
            any = true;
        }
    }
    return any;
}

/** The numbers given, as many as were written before the first wildcard; `undefined` when it is no version. */
function parsePartial(text: string): number[] | undefined {
    const match = PARTIAL.exec(text);
    if (!match) {
        return undefined;
    }
    const numbers: number[] = [];
    // A group that did not take part is undefined, whatever the type says.
    for (const part of match.slice(1, 4) as (string | undefined)[]) {
        if (part === undefined || !/^\d+$/u.test(part)) {
            break;
        }
        numbers.push(Number(part));
    }
    return numbers;
}

function intervalsOf(set: string): Interval[] | undefined {
    if (['', '*', 'x', 'X'].includes(set)) {
        return [{}];
    }
    const hyphen = set.split(' - ');
    if (hyphen.length === 2) {
        const from = parsePartial(hyphen[0]?.trim() ?? '');
        const to = parsePartial(hyphen[1]?.trim() ?? '');
        return from === undefined || to === undefined ? undefined : [{ ...lowerOf(from), ...upperOfInclusive(to) }];
    }
    const intervals: Interval[] = [];
    // `>= 1.2` is written with a space too.
    for (const comparator of set.replaceAll(/([<=>^~])\s+/gu, '$1').split(/\s+/u)) {
        const interval = comparatorOf(comparator);
        if (interval === undefined) {
            return undefined;
        }
        intervals.push(interval);
    }
    return intervals;
}

function comparatorOf(text: string): Interval | undefined {
    const operator = ['>=', '<=', '>', '<', '=', '^', '~'].find(candidate => text.startsWith(candidate)) ?? '';
    const parts = parsePartial(text.slice(operator.length).trim());
    if (parts === undefined) {
        return undefined;
    }
    switch (operator) {
        case '>=': {
            return lowerOf(parts);
        }
        case '>': {
            return parts.length === 3
                ? { lower: { version: triple(parts), inclusive: false } }
                : parts.length === 0
                  ? { upper: { version: [0, 0, 0], inclusive: false } }
                  : lowerOf(next(parts));
        }
        case '<': {
            return { upper: { version: triple(parts), inclusive: false } };
        }
        case '<=': {
            return upperOfInclusive(parts);
        }
        case '^': {
            const firstNonZero = parts.findIndex(part => part !== 0);
            const keep =
                parts.length === 0 ? 0 : firstNonZero === -1 ? parts.length : Math.min(firstNonZero + 1, parts.length);
            return { ...lowerOf(parts), ...upperBefore(parts.slice(0, Math.max(keep, 1))) };
        }
        case '~': {
            return { ...lowerOf(parts), ...upperBefore(parts.slice(0, Math.min(parts.length, 2))) };
        }
        default: {
            return parts.length === 3
                ? { ...lowerOf(parts), ...upperOfInclusive(parts) }
                : { ...lowerOf(parts), ...upperBefore(parts) };
        }
    }
}

function lowerOf(parts: readonly number[]): Interval {
    return { lower: { version: triple(parts), inclusive: true } };
}

/** At most the version written: `<=1.2` is anything before 1.3.0. */
function upperOfInclusive(parts: readonly number[]): Interval {
    if (parts.length === 0) {
        return {};
    }
    return parts.length === 3 ? { upper: { version: triple(parts), inclusive: true } } : upperBefore(parts);
}

/** Before the next version at the last part written: `1.2` → `<1.3.0`, `1` → `<2.0.0`. */
function upperBefore(parts: readonly number[]): Interval {
    return parts.length === 0 ? {} : { upper: { version: triple(next(parts)), inclusive: false } };
}

function next(parts: readonly number[]): number[] {
    const bumped = [...parts];
    bumped[bumped.length - 1] = (bumped.at(-1) ?? 0) + 1;
    return bumped;
}

function triple(parts: readonly number[]): Triple {
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function isWithin(version: Triple, interval: Interval): boolean {
    const { lower, upper } = interval;
    if (lower) {
        const order = compare(version, lower.version);
        if (order < 0 || (order === 0 && !lower.inclusive)) {
            return false;
        }
    }
    if (upper) {
        const order = compare(version, upper.version);
        if (order > 0 || (order === 0 && !upper.inclusive)) {
            return false;
        }
    }
    return true;
}

function compare(a: Triple, b: Triple): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
