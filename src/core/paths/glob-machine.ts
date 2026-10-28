/** One state of the matching machine: it reads one character, or splits in two without reading. */
interface MachineState {
    readonly test?: (char: string) => boolean;
    out: number;
    readonly other: number;
}

type GlobNode =
    | { readonly kind: 'char'; readonly test: (char: string) => boolean }
    | { readonly kind: 'rest' }
    | { readonly kind: 'segments' }
    | { readonly kind: 'star' }
    | { readonly kind: 'alternatives'; readonly options: readonly GlobNode[][] };

const NOT_SLASH = (char: string): boolean => char !== '/';
const IS_SLASH = (char: string): boolean => char === '/';
const ANY = (): boolean => true;
const MATCH = -1;
const NONE = -2;

/**
 * The same glob as `translate` reads it, matched by a Thompson machine: every state the pattern
 * could be in is followed at once, so a path of n characters takes at most n times the size of the
 * pattern, however many `*` it has. (A regular expression backtracks instead, and pays for each way
 * of sharing the name between the stars.)
 */
export function compileMachine(body: string, isFolderAndBelow: boolean): (path: string) => boolean {
    const states: MachineState[] = [];
    const add = (state: MachineState): number => {
        states.push(state);
        return states.length - 1;
    };
    const point = (from: number, to: number): void => {
        const state = states[from];
        if (state) state.out = to;
    };
    const loop = (test: (char: string) => boolean, next: number): number => {
        const split = add({ out: NONE, other: next });
        point(split, add({ test, out: split, other: NONE }));
        return split;
    };
    const build = (nodes: readonly GlobNode[], end: number): number => {
        let next = end;
        for (const node of nodes.toReversed()) {
            switch (node.kind) {
                case 'char': {
                    next = add({ test: node.test, out: next, other: NONE });
                    break;
                }
                case 'star': {
                    next = loop(NOT_SLASH, next);
                    break;
                }
                case 'rest': {
                    next = loop(ANY, next);
                    break;
                }
                case 'segments': {
                    // Any number of (one or more non-slashes, then a slash).
                    const split = add({ out: NONE, other: next });
                    const slash = add({ test: IS_SLASH, out: split, other: NONE });
                    const again = add({ out: NONE, other: slash });
                    const first = add({ test: NOT_SLASH, out: again, other: NONE });
                    point(again, first);
                    point(split, first);
                    next = split;
                    break;
                }
                case 'alternatives': {
                    const after = next;
                    const starts = node.options.map(option => build(option, after));
                    next = starts.reduceRight((rest, start) => add({ out: start, other: rest }));
                    break;
                }
            }
        }
        return next;
    };
    let end = MATCH;
    if (isFolderAndBelow) {
        // `(?:/.*)?`: the folder itself, or a slash and anything after it.
        const rest = loop(ANY, MATCH);
        end = add({ out: add({ test: IS_SLASH, out: rest, other: NONE }), other: MATCH });
    }
    const start = build(parseGlob(body, { index: 0 }, false), end);

    return path => {
        const seen = new Int32Array(states.length).fill(-1);
        let generation = 0;
        /** Adds the reading states reachable from `from` without reading; whether the end is one of them. */
        const reach = (from: number, into: number[]): boolean => {
            let isEnd = false;
            const pending = [from];
            for (let state = pending.pop(); state !== undefined; state = pending.pop()) {
                const node = states[state];
                if (state === MATCH) {
                    isEnd = true;
                } else if (node && seen[state] !== generation) {
                    seen[state] = generation;
                    if (node.test) {
                        into.push(state);
                    } else {
                        pending.push(node.other, node.out);
                    }
                }
            }
            return isEnd;
        };
        let current: number[] = [];
        let matched = reach(start, current);
        for (const char of path) {
            generation++;
            matched = false;
            const next: number[] = [];
            for (const state of current) {
                const node = states[state];
                if (node?.test?.(char) === true && reach(node.out, next)) {
                    matched = true;
                }
            }
            if (next.length === 0 && !matched) {
                return false;
            }
            current = next;
        }
        return matched;
    };
}

/** Reads a glob into nodes, each character with the meaning `token` gives it; `{…}` nests. */
function parseGlob(pattern: string, at: { index: number }, inBraces: boolean): GlobNode[] {
    const nodes: GlobNode[] = [];
    while (at.index < pattern.length) {
        const index = at.index;
        const char = String.fromCodePoint(pattern.codePointAt(index) ?? 0);
        if (inBraces && (char === ',' || char === '}')) {
            return nodes;
        }
        if (char === '*') {
            const isDouble = pattern[index + 1] === '*';
            const startsSegment = index === 0 || pattern[index - 1] === '/';
            if (isDouble && startsSegment && pattern[index + 2] === '/') {
                nodes.push({ kind: 'segments' });
                at.index += 3;
            } else if (isDouble && startsSegment && index + 2 === pattern.length) {
                nodes.push({ kind: 'rest' });
                at.index += 2;
            } else {
                nodes.push({ kind: 'star' });
                at.index += 1;
            }
            continue;
        }
        if (char === '{') {
            at.index++;
            const options: GlobNode[][] = [];
            let closing: string | undefined = ',';
            while (closing === ',') {
                options.push(parseGlob(pattern, at, true));
                closing = pattern[at.index];
                at.index++;
            }
            nodes.push({ kind: 'alternatives', options });
            continue;
        }
        const close = char === '[' ? pattern.indexOf(']', index + 1) : -1;
        if (close !== -1) {
            nodes.push({ kind: 'char', test: classTest(pattern.slice(index + 1, close)) });
            at.index = close + 1;
            continue;
        }
        nodes.push({ kind: 'char', test: char === '?' ? NOT_SLASH : candidate => candidate === char });
        at.index += char.length;
    }
    return nodes;
}

/** `[abc]`, `[a-z]`, and `[!abc]` or `[^abc]` (which never take a slash), as a character class reads them. */
function classTest(body: string): (char: string) => boolean {
    const isNegated = body.startsWith('!') || body.startsWith('^');
    // By code point, as a regular expression with the `u` flag reads a class.
    const codes = Array.from(isNegated ? body.slice(1) : body, char => char.codePointAt(0) ?? 0);
    const ranges: (readonly [number, number])[] = [];
    const dash = 45;
    for (let index = 0; index < codes.length; index++) {
        const from = codes[index] ?? 0;
        const to = codes[index + 2];
        if (codes[index + 1] === dash && to !== undefined) {
            ranges.push([from, to]);
            index += 2;
        } else {
            ranges.push([from, from]);
        }
    }
    return char => {
        const code = char.codePointAt(0) ?? 0;
        const inside = ranges.some(([from, to]) => code >= from && code <= to);
        return isNegated ? char !== '/' && !inside : inside;
    };
}
