/**
 * The glob patterns of the configuration, on paths relative to the root with `/` separators.
 *
 * | Pattern  | Matches                                        |
 * | -------- | ---------------------------------------------- |
 * | `*`      | anything inside one segment                    |
 * | `**`     | any number of segments, none included          |
 * | `x/**`   | `x` and everything under it                    |
 * | `?`      | one character that is not `/`                  |
 * | `{a,b}`  | either alternative                             |
 * | `[abc]`  | one of the characters (`[!abc]` negates)       |
 *
 * A pattern without `/` matches at any depth (`node_modules` is `**\/node_modules`), the way
 * `.gitignore` reads it; with a `/` it is anchored at the root, and a leading `/` anchors a single
 * name (`/data` is the root's `data`, not `lib/data`).
 */
export interface Glob {
    readonly source: string;
    test(path: string): boolean;
}

export function compileGlob(pattern: string): Glob {
    return compileGlobWith(pattern, undefined);
}

/**
 * A glob matched by one matcher, for the tests that compare them. Without one (`compileGlob`), a
 * pattern that could backtrack is matched by the machine, and any other by a regular expression.
 */
export function compileGlobWith(pattern: string, matcher: 'expression' | 'machine' | undefined): Glob {
    const isRooted = pattern.startsWith('/') || pattern.startsWith('./');
    const trimmed = trimSlashes(pattern.startsWith('./') ? pattern.slice(2) : pattern);
    const anchored = isRooted || trimmed.includes('/') ? trimmed : `**/${trimmed}`;
    // A final `/**` takes the folder itself too, as minimatch and picomatch read it: `src/generated/**`
    // leaves out `src/generated`, not only what is inside it.
    const isFolderAndBelow = anchored.endsWith('/**');
    const body = isFolderAndBelow ? anchored.slice(0, -3) : anchored;
    if (matcher === 'machine' || (matcher === undefined && canBacktrack(body))) {
        const machine = compileMachine(body, isFolderAndBelow);
        return { source: pattern, test: path => machine(path) };
    }
    const expression = new RegExp(`^${translate(body)}${isFolderAndBelow ? '(?:/.*)?' : ''}$`, 'u');
    return { source: pattern, test: path => expression.test(path) };
}

/**
 * Whether the regular expression of a glob could take more than linear time. Each `*` is `[^/]*`,
 * and k of them in one segment cost up to n^k steps: `*a*a*a*a*a*a*c` took 52 seconds on a name of
 * 100 characters. The same goes for repeated `**\/` and many brace groups. Globs come from
 * configurations, and a bot that checks other people's repositories reads theirs, so those patterns
 * are matched by `compileMachine` instead, in time proportional to the path times the pattern. The
 * usual ones (`*.test.ts`, `src/**`, `{a,b}`) keep the regular expression, which is faster.
 */
function canBacktrack(body: string): boolean {
    return (
        body.includes('**/**') ||
        body.split('{').length - 1 > 2 ||
        body.split('/').some(segment => segment !== '**' && segment.split('*').length - 1 > 2)
    );
}

/**
 * Whether a path, or any folder above it, matches one of the globs: excluding `fixtures` excludes
 * `fixtures/vite/dist/main.js`. The folders are tried from the top down, so a path inside an
 * excluded folder stops at that folder instead of testing every one below it first.
 */
export function matchesSelfOrAncestor(path: string, globs: readonly Glob[]): boolean {
    if (globs.length === 0) {
        return false;
    }
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
        const folder = path.slice(0, slash);
        if (globs.some(glob => glob.test(folder))) {
            return true;
        }
    }
    return globs.some(glob => glob.test(path));
}

/** Whether a pattern is one `compileGlob` can read; the message says why not. */
export function globProblem(pattern: string): string | undefined {
    if (pattern.trim() === '') {
        return 'is empty';
    }
    // How many of each are open: +1 for an opening character, -1 for a closing one.
    const depth = { '{': 0, '[': 0 };
    const pairs: Readonly<Record<string, ['[' | '{', number]>> = {
        '{': ['{', 1],
        '}': ['{', -1],
        '[': ['[', 1],
        ']': ['[', -1],
    };
    for (const char of pattern) {
        const pair = pairs[char];
        if (pair) {
            depth[pair[0]] += pair[1];
        }
        if (depth['{'] < 0 || depth['['] < 0) {
            return `closes a "${char}" it never opened`;
        }
    }
    if (depth['{'] !== 0) return 'leaves a "{" open';
    if (depth['['] !== 0) return 'leaves a "[" open';
    return pattern.includes('\\') ? 'uses "\\"; paths are written with "/"' : undefined;
}

/** Turns a glob into the source of a regular expression, one token at a time. */
function translate(pattern: string): string {
    let out = '';
    let index = 0;
    const braces = { open: 0 };
    while (index < pattern.length) {
        const [source, length] = token(pattern, index, braces);
        out += source;
        index += length;
    }
    return out;
}

/** The regular expression for the token at `index`, and how many characters of the glob it used. */
function token(pattern: string, index: number, braces: { open: number }): [string, number] {
    const char = pattern[index] ?? '';
    if (char === '*') {
        const isDouble = pattern[index + 1] === '*';
        const startsSegment = index === 0 || pattern[index - 1] === '/';
        if (isDouble && startsSegment && pattern[index + 2] === '/') {
            // `**/` is zero or more whole segments.
            return ['(?:[^/]+/)*', 3];
        }
        if (isDouble && startsSegment && index + 2 === pattern.length) {
            // A final `**` is the rest of the path.
            return ['.*', 2];
        }
        return ['[^/]*', 1];
    }
    if (char === '?') {
        return ['[^/]', 1];
    }
    if (char === '{') {
        braces.open++;
        return ['(?:', 1];
    }
    if (char === '}' && braces.open > 0) {
        braces.open--;
        return [')', 1];
    }
    if (char === ',' && braces.open > 0) {
        return ['|', 1];
    }
    if (char === '[') {
        const close = pattern.indexOf(']', index + 1);
        if (close === -1) {
            return [String.raw`\[`, 1];
        }
        const body = pattern.slice(index + 1, close);
        const isNegated = body.startsWith('!') || body.startsWith('^');
        const chars = escapeClass(isNegated ? body.slice(1) : body);
        return [isNegated ? `[^/${chars}]` : `[${chars}]`, close - index + 1];
    }
    return [escapeChar(char), 1];
}

function escapeChar(char: string): string {
    return /[$()+.^|\\\][{}]/u.test(char) ? `\\${char}` : char;
}

function escapeClass(body: string): string {
    let out = '';
    for (const char of body) {
        out += ['\\', ']', '[', '^'].includes(char) ? `\\${char}` : char;
    }
    return out;
}

function trimSlashes(pattern: string): string {
    let start = 0;
    let end = pattern.length;
    while (start < end && pattern[start] === '/') start++;
    while (end > start && pattern[end - 1] === '/') end--;
    return pattern.slice(start, end);
}

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
function compileMachine(body: string, isFolderAndBelow: boolean): (path: string) => boolean {
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
