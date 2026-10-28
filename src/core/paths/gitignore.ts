/**
 * `.gitignore` files, read the way git reads them, for when the files come from the disk instead of
 * from git (`--no-git`, or a folder outside any repository). With git, git answers and this is not
 * used: it is the fallback that keeps `android/build` out of a run without git, not a second opinion.
 *
 * What it reads: comments, `\` escapes, `!` negation, a trailing `/` for folders only, a leading or
 * middle `/` anchoring the pattern to the file's folder, `*`, `?`, `[a-z]`, `[!a]` and `**` as a whole
 * segment. Last match wins, and a deeper file wins over the ones above it. A folder that is ignored is
 * not walked, so nothing inside it can be brought back, as in git.
 *
 * Matching is a loop over segments and characters with one saved position per star, not a regular
 * expression: it cannot backtrack exponentially on a long name.
 */

/** One piece of a segment pattern. */
type Token =
    | { readonly kind: 'star' }
    | { readonly kind: 'any' }
    | { readonly kind: 'char'; readonly char: string }
    | { readonly kind: 'class'; readonly negated: boolean; readonly ranges: readonly (readonly [string, string])[] };

/** A segment of a pattern: `**`, or the tokens of one name. */
type Segment = 'globstar' | readonly Token[];

export interface IgnoreRule {
    readonly source: string;
    readonly negated: boolean;
    readonly folderOnly: boolean;
    readonly segments: readonly Segment[];
}

/** The rules of one `.gitignore`, with where it is. */
export interface IgnoreFile {
    /** The folder it is in, relative to the root (`''` for the root); for a file above the root, `''`. */
    readonly folder: string;
    /** For a file above the root: the root's path from the file's folder (`android` for `../.gitignore`). */
    readonly above: string;
    readonly rules: readonly IgnoreRule[];
    readonly ignoreCase: boolean;
}

/** Reads the text of a `.gitignore`. Lines it cannot read are skipped, as git skips them. */
export function parseGitignore(text: string): IgnoreRule[] {
    const rules: IgnoreRule[] = [];
    for (const raw of text.split('\n')) {
        const rule = parseLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
        if (rule) {
            rules.push(rule);
        }
    }
    return rules;
}

/** Whether a path (relative to the root, `/`-separated) is ignored by these files, the deepest last. */
export function isIgnored(files: readonly IgnoreFile[], path: string, isFolder: boolean): boolean {
    for (let index = files.length - 1; index >= 0; index--) {
        const file = files[index];
        if (!file) {
            continue;
        }
        const local =
            file.above === ''
                ? file.folder === ''
                    ? path
                    : path.startsWith(`${file.folder}/`)
                      ? path.slice(file.folder.length + 1)
                      : undefined
                : `${file.above}/${path}`;
        if (local === undefined) {
            continue;
        }
        const names = (file.ignoreCase ? local.toLowerCase() : local).split('/');
        for (let ruleIndex = file.rules.length - 1; ruleIndex >= 0; ruleIndex--) {
            const rule = file.rules[ruleIndex];
            if (!rule || (rule.folderOnly && !isFolder)) {
                continue;
            }
            if (matchSegments(rule.segments, names, file.ignoreCase)) {
                return !rule.negated;
            }
        }
    }
    return false;
}

function parseLine(line: string): IgnoreRule | undefined {
    if (line === '' || line.startsWith('#')) {
        return undefined;
    }
    let text = trimTrailingSpaces(line);
    let negated = false;
    if (text.startsWith('!')) {
        negated = true;
        text = text.slice(1);
    }
    let folderOnly = false;
    while (text.endsWith('/')) {
        folderOnly = true;
        text = text.slice(0, -1);
    }
    if (text === '') {
        return undefined;
    }
    const isAnchored = text.includes('/');
    if (text.startsWith('/')) {
        text = text.slice(1);
    }
    const parts = text.split('/').filter(part => part !== '');
    const segments: Segment[] = parts.map(part => (part === '**' ? 'globstar' : tokenize(part)));
    if (segments.at(-1) === 'globstar') {
        // A final `/**` is everything inside, not the folder itself: one name or more.
        segments.splice(-1, 1, [{ kind: 'star' }], 'globstar');
    }
    return {
        source: line,
        negated,
        folderOnly,
        segments: isAnchored ? segments : ['globstar', ...segments],
    };
}

/** Trailing spaces go, unless the last one is escaped with `\`. */
function trimTrailingSpaces(line: string): string {
    let end = line.length;
    while (end > 0 && line[end - 1] === ' ' && line[end - 2] !== '\\') end--;
    return line.slice(0, end);
}

function tokenize(part: string): Token[] {
    const tokens: Token[] = [];
    for (let index = 0; index < part.length; index++) {
        const char = part[index] ?? '';
        if (char === '\\' && index + 1 < part.length) {
            index++;
            tokens.push({ kind: 'char', char: part[index] ?? '' });
        } else if (char === '*') {
            // `**` inside a name is a star like any other.
            if (tokens.at(-1)?.kind !== 'star') {
                tokens.push({ kind: 'star' });
            }
        } else if (char === '?') {
            tokens.push({ kind: 'any' });
        } else if (char === '[' && part.includes(']', index + 2)) {
            const close = part.indexOf(']', index + 2);
            let body = part.slice(index + 1, close);
            const negated = body.startsWith('!') || body.startsWith('^');
            if (negated) {
                body = body.slice(1);
            }
            const ranges: [string, string][] = [];
            for (let at = 0; at < body.length; at++) {
                const from = body[at] ?? '';
                if (body[at + 1] === '-' && at + 2 < body.length) {
                    ranges.push([from, body[at + 2] ?? '']);
                    at += 2;
                } else {
                    ranges.push([from, from]);
                }
            }
            tokens.push({ kind: 'class', negated, ranges });
            index = close;
        } else {
            tokens.push({ kind: 'char', char });
        }
    }
    return tokens;
}

/** Segments against names: `**` takes any number of names, and the last `**` seen is where to retry. */
function matchSegments(segments: readonly Segment[], names: readonly string[], ignoreCase: boolean): boolean {
    let segment = 0;
    let name = 0;
    let retrySegment = -1;
    let retryName = 0;
    while (name < names.length) {
        const current = segments[segment];
        if (current === 'globstar') {
            retrySegment = segment;
            retryName = name;
            segment++;
            continue;
        }
        if (current !== undefined && matchName(current, names[name] ?? '', ignoreCase)) {
            segment++;
            name++;
            continue;
        }
        if (retrySegment === -1) {
            return false;
        }
        segment = retrySegment + 1;
        retryName++;
        name = retryName;
    }
    while (segments[segment] === 'globstar') segment++;
    return segment === segments.length;
}

/** Tokens against the characters of one name, the same way: the last star seen is where to retry. */
function matchName(tokens: readonly Token[], name: string, ignoreCase: boolean): boolean {
    let token = 0;
    let char = 0;
    let retryToken = -1;
    let retryChar = 0;
    while (char < name.length) {
        const current = tokens[token];
        if (current?.kind === 'star') {
            retryToken = token;
            retryChar = char;
            token++;
            continue;
        }
        if (current !== undefined && matchChar(current, name[char] ?? '', ignoreCase)) {
            token++;
            char++;
            continue;
        }
        if (retryToken === -1) {
            return false;
        }
        token = retryToken + 1;
        retryChar++;
        char = retryChar;
    }
    while (tokens[token]?.kind === 'star') token++;
    return token === tokens.length;
}

function matchChar(token: Token, char: string, ignoreCase: boolean): boolean {
    switch (token.kind) {
        case 'any': {
            return true;
        }
        case 'char': {
            return (ignoreCase ? token.char.toLowerCase() : token.char) === char;
        }
        case 'class': {
            const inside = token.ranges.some(([from, to]) =>
                ignoreCase ? char >= from.toLowerCase() && char <= to.toLowerCase() : char >= from && char <= to,
            );
            return inside !== token.negated;
        }
        default: {
            return false;
        }
    }
}
