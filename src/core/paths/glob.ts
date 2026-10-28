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
    /**
     * The folders a path must be in (or be) to match, as far as the pattern spells them out: `apps/web`
     * for `apps/web/src/**`, `apps` for `apps/*\/src`, empty for `**\/src` or `*.ts`. With
     * `segment`, it is how overrides are found for a folder without trying every one.
     */
    readonly prefix: string;
    /** For a pattern that starts with `**\/` and a plain name (`**\/tests/**`): a segment every match holds. */
    readonly segment: string | undefined;
    /** For a pattern that is one plain name at any depth (`node_modules`, `**\/locales`): that name. */
    readonly name: string | undefined;
    /** Whether only the last segment of a path decides (`*.png`, `node_modules`). */
    readonly lastSegment: boolean;
}

const GLOB_CHARS = /[*?[\]{}]/u;

export function compileGlob(pattern: string): Glob {
    const isRooted = pattern.startsWith('/') || pattern.startsWith('./');
    const trimmed = trimSlashes(pattern.startsWith('./') ? pattern.slice(2) : pattern);
    const anchored = isRooted || trimmed.includes('/') ? trimmed : `**/${trimmed}`;
    const rest = anchored.startsWith('**/') ? anchored.slice(3) : undefined;
    const first = rest?.split('/', 1)[0];
    const segment = first !== undefined && !GLOB_CHARS.test(first) ? first : undefined;
    const isOneSegment = rest !== undefined && !rest.includes('/') && !rest.includes('**');
    if (isOneSegment && segment !== undefined) {
        // A plain name at any depth is the last segment of the path: no expression to run.
        const name = segment;
        return {
            source: pattern,
            test: path => baseNameOf(path) === name,
            prefix: '',
            segment,
            name,
            lastSegment: true,
        };
    }
    // A final `/**` takes the folder itself too, as minimatch and picomatch read it: `src/generated/**`
    // leaves out `src/generated`, not only what is inside it.
    const source = anchored.endsWith('/**') ? `${translate(anchored.slice(0, -3))}(?:/.*)?` : translate(anchored);
    const expression = new RegExp(`^${source}$`, 'u');
    return {
        source: pattern,
        test: path => expression.test(path),
        prefix: literalPrefix(anchored),
        segment,
        name: undefined,
        lastSegment: isOneSegment,
    };
}

/** The leading segments of an anchored pattern that are plain names: `apps/web` of `apps/web/*.ts`. */
function literalPrefix(anchored: string): string {
    const literal: string[] = [];
    for (const part of anchored.split('/')) {
        if (GLOB_CHARS.test(part)) {
            break;
        }
        literal.push(part);
    }
    return literal.join('/');
}

function baseNameOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Whether a path, or any folder above it, matches one of the globs: excluding `fixtures` excludes
 * `fixtures/vite/dist/main.js`. The folders are tried from the top down, so a path inside an
 * excluded folder stops at that folder instead of testing every one below it first.
 *
 * For many paths against the same globs, `PathMatcher` remembers each folder's answer.
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

/**
 * `matchesSelfOrAncestor` for a whole file list: every folder is tested once, however many files it
 * holds, and the plain names (`node_modules`, `__pycache__`, most of an `exclude`) are one set lookup
 * instead of an expression each. On 200 000 paths this is what makes `exclude` cheap.
 */
export class PathMatcher {
    private readonly names: ReadonlySet<string>;
    /** Patterns that only read the last segment (`*.png`): their answer is remembered by name. */
    private readonly segmentPatterns: readonly Glob[];
    private readonly patterns: readonly Glob[];
    private readonly folders = new Map<string, boolean>();
    private readonly segments = new Map<string, boolean>();
    readonly isEmpty: boolean;

    constructor(globs: readonly Glob[]) {
        this.names = new Set(globs.map(glob => glob.name).filter(name => name !== undefined));
        this.segmentPatterns = globs.filter(glob => glob.name === undefined && glob.lastSegment);
        this.patterns = globs.filter(glob => glob.name === undefined && !glob.lastSegment);
        this.isEmpty = globs.length === 0;
    }

    /** Whether the path itself matches, without looking at the folders above it. */
    test(path: string): boolean {
        const name = baseNameOf(path);
        if (this.names.has(name)) {
            return true;
        }
        if (this.segmentPatterns.length > 0) {
            let byName = this.segments.get(name);
            if (byName === undefined) {
                byName = this.segmentPatterns.some(glob => glob.test(name));
                this.segments.set(name, byName);
            }
            if (byName) {
                return true;
            }
        }
        return this.patterns.some(glob => glob.test(path));
    }

    matchesSelfOrAncestor(path: string): boolean {
        if (this.isEmpty) {
            return false;
        }
        const slash = path.lastIndexOf('/');
        return (slash !== -1 && this.folderMatches(path.slice(0, slash))) || this.test(path);
    }

    /** Whether a folder or one above it matches, remembered for every folder on the way. */
    private folderMatches(folder: string): boolean {
        const known = this.folders.get(folder);
        if (known !== undefined) {
            return known;
        }
        // Up to the first folder already known, then down again, so a deep tree costs no recursion.
        const pending: string[] = [];
        let current: string | undefined = folder;
        let above = false;
        while (current !== undefined) {
            const answer = this.folders.get(current);
            if (answer !== undefined) {
                above = answer;
                break;
            }
            pending.push(current);
            const slash = current.lastIndexOf('/');
            current = slash === -1 ? undefined : current.slice(0, slash);
        }
        for (const path of pending.toReversed()) {
            above ||= this.test(path);
            this.folders.set(path, above);
        }
        return above;
    }
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
