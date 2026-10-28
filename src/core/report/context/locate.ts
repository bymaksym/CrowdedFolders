/**
 * The line (1-based) where a sequence of texts appears in a file, each searched after the previous
 * one: `lineOfSequence(file, [['"overrides"'], ['"src/**"', "'src/**'"]])` finds the override's glob
 * wherever the file is JSON, JSONC or JavaScript. A text with alternatives matches the first one that
 * occurs. `undefined` when one is missing.
 */
export function lineOfSequence(text: string, steps: readonly (readonly string[])[]): number | undefined {
    let from = 0;
    for (const alternatives of steps) {
        let found = -1;
        for (const needle of alternatives) {
            const at = text.indexOf(needle, from);
            if (at !== -1 && (found === -1 || at < found)) {
                found = at;
            }
        }
        if (found === -1) {
            return undefined;
        }
        from = found + 1;
    }
    let line = 1;
    for (let index = 0; index < from - 1; index++) {
        if (text.codePointAt(index) === 10) {
            line++;
        }
    }
    return line;
}

/** Both ways a string is written in a configuration: `"x"` (JSON) and `'x'` (JavaScript). */
export function quoted(value: string): string[] {
    return [JSON.stringify(value), `'${value}'`];
}
