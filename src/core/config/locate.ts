/**
 * Where a setting is written in a configuration file, for an error an editor can turn into a link
 * (`crowded-folders.config.json:4:15`). The text is read the way `parseJsonc` reads it: comments and
 * trailing commas allowed. Nothing here throws: a text it cannot follow has no position.
 */

const DEPTH = 64;

/** The line and column (both from 1) of an offset in a text. */
export function positionOf(text: string, offset: number): { readonly line: number; readonly column: number } {
    let line = 1;
    let start = 0;
    for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) {
        line++;
        start = index + 1;
    }
    return { line, column: offset - start + 1 };
}

/**
 * The offset of the key or element a problem's `at` names (`overrides[0].rules.max-files`), or
 * `undefined` when the text has no such place. A key is found by its name, so it points at the key.
 */
export function offsetOfPath(text: string, at: string, under: readonly string[] = []): number | undefined {
    const written = [...at.matchAll(/\[("(?:[^"\\]|\\.)*")\]|\[(\d+)\]|([^.[\]]+)/gu)];
    const segments = [
        ...under,
        ...written.map(match => (match[1] === undefined ? (match[2] ?? match[3] ?? '') : unquote(match[1]))),
    ];
    if (segments.length === under.length || at.startsWith('(')) {
        return undefined;
    }
    return new Walker(text).find(text.startsWith('\u{FEFF}') ? 1 : 0, segments, 0);
}

function unquote(text: string): string {
    try {
        return JSON.parse(text) as string;
    } catch {
        return text.slice(1, -1);
    }
}

class Walker {
    private readonly text: string;

    constructor(text: string) {
        this.text = text;
    }

    find(from: number, segments: readonly string[], depth: number): number | undefined {
        const [segment, ...rest] = segments;
        const start = this.skipSpace(from);
        if (segment === undefined || depth > DEPTH) {
            return start;
        }
        const open = this.text[start];
        if (open === '{') {
            return this.findKey(start + 1, segment, rest, depth);
        }
        return open === '[' ? this.findElement(start + 1, Number(segment), rest, depth) : undefined;
    }

    private findKey(from: number, name: string, rest: readonly string[], depth: number): number | undefined {
        let at = this.skipSpace(from);
        while (at < this.text.length && this.text[at] !== '}') {
            if (this.text[at] !== '"') {
                return undefined;
            }
            const end = this.endOfString(at);
            const key = this.decode(at, end);
            const colon = this.skipSpace(end);
            if (this.text[colon] !== ':') {
                return undefined;
            }
            const value = this.skipSpace(colon + 1);
            if (key === name) {
                return rest.length === 0 ? at : this.find(value, rest, depth + 1);
            }
            at = this.afterComma(this.skipValue(value, depth + 1));
        }
        return undefined;
    }

    private findElement(from: number, index: number, rest: readonly string[], depth: number): number | undefined {
        let at = this.skipSpace(from);
        for (let position = 0; at < this.text.length && this.text[at] !== ']'; position++) {
            if (position === index) {
                return rest.length === 0 ? at : this.find(at, rest, depth + 1);
            }
            at = this.afterComma(this.skipValue(at, depth + 1));
        }
        return undefined;
    }

    private afterComma(from: number): number {
        const at = this.skipSpace(from);
        return this.text[at] === ',' ? this.skipSpace(at + 1) : at;
    }

    /** The offset just after the value that starts at `from`. */
    private skipValue(from: number, depth: number): number {
        const char = this.text[from];
        if (char === '"') {
            return this.endOfString(from);
        }
        if ((char === '{' || char === '[') && depth <= DEPTH) {
            const close = char === '{' ? '}' : ']';
            let at = this.skipSpace(from + 1);
            while (at < this.text.length && this.text[at] !== close) {
                if (char === '{') {
                    at = this.skipSpace(this.endOfString(at));
                    at = this.skipSpace(at + 1);
                }
                at = this.afterComma(this.skipValue(at, depth + 1));
            }
            return at + 1;
        }
        let at = from;
        while (at < this.text.length && !/[\s,\]}]/u.test(this.text[at] ?? '')) {
            at++;
        }
        return Math.max(at, from + 1);
    }

    private endOfString(from: number): number {
        let at = from + 1;
        while (at < this.text.length && this.text[at] !== '"') {
            at += this.text[at] === '\\' ? 2 : 1;
        }
        return at + 1;
    }

    private decode(from: number, end: number): string {
        try {
            return JSON.parse(this.text.slice(from, end)) as string;
        } catch {
            return this.text.slice(from + 1, end - 1);
        }
    }

    private skipSpace(from: number): number {
        let at = from;
        for (;;) {
            const char = this.text[at];
            if (char !== undefined && /\s/u.test(char)) {
                at++;
            } else if (char === '/' && this.text[at + 1] === '/') {
                const end = this.text.indexOf('\n', at);
                at = end === -1 ? this.text.length : end;
            } else if (char === '/' && this.text[at + 1] === '*') {
                const end = this.text.indexOf('*/', at + 2);
                at = end === -1 ? this.text.length : end + 2;
            } else {
                return at;
            }
        }
    }
}

/**
 * The offset of the first thing that is not JSON in a text (comments and trailing commas already
 * blanked out, as `stripJsonc` leaves it); the text's length when it ends too soon; `undefined` when it
 * is JSON. `JSON.parse` says it differently from one Node to the next, so the position is found here.
 */
export function syntaxErrorOffset(text: string): number | undefined {
    const syntax = new Syntax(text);
    const end = syntax.value(syntax.skip(0), 0);
    if (end === undefined) {
        return syntax.failedAt;
    }
    const rest = syntax.skip(end);
    return rest < text.length ? rest : undefined;
}

class Syntax {
    failedAt = 0;
    private readonly text: string;

    constructor(text: string) {
        this.text = text;
    }

    skip(from: number): number {
        let at = from;
        while (at < this.text.length && /\s/u.test(this.text[at] ?? '')) {
            at++;
        }
        return at;
    }

    /** The offset after the value at `from`, or `undefined` with `failedAt` set. */
    value(from: number, depth: number): number | undefined {
        const char = this.text[from];
        if (char === undefined || depth > DEPTH) {
            this.fail(char === undefined ? this.text.length : from);
            return;
        }
        if (char === '{' || char === '[') {
            return this.container(from, depth);
        }
        if (char === '"') {
            return this.string(from);
        }
        for (const literal of ['true', 'false', 'null']) {
            if (this.text.startsWith(literal, from)) {
                return from + literal.length;
            }
        }
        const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/iuy;
        number.lastIndex = from;
        const match = number.exec(this.text);
        return match ? from + match[0].length : this.fail(from);
    }

    private container(from: number, depth: number): number | undefined {
        const isObject = this.text[from] === '{';
        const close = isObject ? '}' : ']';
        let at = this.skip(from + 1);
        if (this.text[at] === close) {
            return at + 1;
        }
        for (;;) {
            if (isObject) {
                if (this.text[at] !== '"') {
                    this.fail(at);
                    return;
                }
                const key = this.string(at);
                if (key === undefined) {
                    return undefined;
                }
                at = this.skip(key);
                if (this.text[at] !== ':') {
                    this.fail(at);
                    return;
                }
                at = this.skip(at + 1);
            }
            const end = this.value(at, depth + 1);
            if (end === undefined) {
                return undefined;
            }
            at = this.skip(end);
            if (this.text[at] === close) {
                return at + 1;
            }
            if (this.text[at] !== ',') {
                this.fail(at);
                return;
            }
            at = this.skip(at + 1);
        }
    }

    private string(from: number): number | undefined {
        let at = from + 1;
        while (at < this.text.length && this.text[at] !== '"') {
            if (this.text[at] === '\n') {
                this.fail(at);
                return;
            }
            at += this.text[at] === '\\' ? 2 : 1;
        }
        return at < this.text.length ? at + 1 : this.fail(this.text.length);
    }

    private fail(at: number): number | undefined {
        this.failedAt = at;
        return;
    }
}
