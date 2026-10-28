/**
 * Parses JSON with comments (`//`, `/* *\/`) and trailing commas, the way `tsconfig.json` and VS
 * Code settings are written. A configuration is where the reason for a setting goes, so comments
 * are allowed in every `.json` this package reads.
 *
 * It blanks comments and trailing commas out — keeping every newline, so `JSON.parse` reports the
 * same line numbers the file has — and hands the rest to `JSON.parse`.
 */
export function parseJsonc(text: string): unknown {
    return JSON.parse(stripJsonc(text));
}

export function stripJsonc(text: string): string {
    const source = text.startsWith('\u{FEFF}') ? text.slice(1) : text;
    let out = '';
    let index = 0;
    // Where the last comma outside a string was written to `out`, until something other than
    // whitespace or a comment follows it.
    let pendingComma = -1;

    while (index < source.length) {
        const char = source[index] ?? '';
        if (char === '"') {
            const end = endOfString(source, index);
            out += source.slice(index, end);
            index = end;
            pendingComma = -1;
            continue;
        }
        const next = source[index + 1] ?? '';
        if (char === '/' && next === '/') {
            const end = source.indexOf('\n', index);
            const stop = end === -1 ? source.length : end;
            out += ' '.repeat(stop - index);
            index = stop;
            continue;
        }
        if (char === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += blank(source.slice(index, stop));
            index = stop;
            continue;
        }
        if (char === ',') {
            pendingComma = out.length;
            out += char;
            index++;
            continue;
        }
        if ((char === '}' || char === ']') && pendingComma !== -1) {
            out = `${out.slice(0, pendingComma)} ${out.slice(pendingComma + 1)}`;
        }
        if (char.trim() !== '') {
            pendingComma = -1;
        }
        out += char;
        index++;
    }
    return out;
}

export interface DuplicateKey {
    /** Where the object is, as a path into the value: `overrides[0].rules`; empty for the top. */
    readonly at: string;
    readonly key: string;
    /** 1-based lines of the first and the repeated key. */
    readonly lines: readonly [number, number];
}

/** An object or a list open at some point of the text. */
interface Frame {
    readonly isObject: boolean;
    readonly at: string;
    readonly keys: Map<string, number>;
    expectsKey: boolean;
    index: number;
    lastKey: string;
}

/** Reads the key of an object; `false` when it is not a JSON string. */
function readKey(frame: Frame, text: string, line: number, found: DuplicateKey[]): boolean {
    let key: string;
    try {
        key = JSON.parse(text) as string;
    } catch {
        return false;
    }
    const first = frame.keys.get(key);
    if (first === undefined) {
        frame.keys.set(key, line);
    } else {
        found.push({ at: frame.at, key, lines: [first, line] });
    }
    frame.lastKey = key;
    frame.expectsKey = false;
    return true;
}

/**
 * The keys written twice in one object. `JSON.parse` keeps the last in silence, so a second `"rules"`
 * replaces the first without a word. Read in one pass over the text with its comments blanked out;
 * a text that is not JSON gives no answer here (the parser says what is wrong with it).
 */
export function duplicateKeys(text: string): DuplicateKey[] {
    const source = stripJsonc(text);
    const found: DuplicateKey[] = [];
    const stack: Frame[] = [];
    let line = 1;
    const childAt = (frame: Frame | undefined): string => {
        if (!frame) return '';
        const step = frame.isObject
            ? /^[$A-Z_a-z][\w$]*$/u.test(frame.lastKey)
                ? `.${frame.lastKey}`
                : `[${JSON.stringify(frame.lastKey)}]`
            : `[${frame.index}]`;
        return frame.at === '' && step.startsWith('.') ? step.slice(1) : `${frame.at}${step}`;
    };
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const top = stack.at(-1);
        switch (char) {
            case '\n': {
                line++;
                break;
            }
            case '"': {
                const end = endOfString(source, index);
                if (top?.isObject && top.expectsKey && !readKey(top, source.slice(index, end), line, found)) {
                    return [];
                }
                index = end - 1;
                break;
            }
            case '{':
            case '[': {
                const isObject = char === '{';
                stack.push({
                    isObject,
                    at: childAt(top),
                    keys: new Map(),
                    expectsKey: isObject,
                    index: 0,
                    lastKey: '',
                });
                break;
            }
            case '}':
            case ']': {
                stack.pop();
                break;
            }
            case ',': {
                if (top?.isObject) top.expectsKey = true;
                else if (top) top.index++;
                break;
            }
            default:
        }
    }
    return found;
}

/** The index just after the closing quote of the string that opens at `start`. */
function endOfString(source: string, start: number): number {
    let index = start + 1;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') {
            index += 2;
            continue;
        }
        if (char === '"') {
            return index + 1;
        }
        index++;
    }
    return source.length;
}

/** Spaces in place of every character except newlines. */
function blank(text: string): string {
    let out = '';
    for (const char of text) {
        out += char === '\n' || char === '\r' ? char : ' ';
    }
    return out;
}
