/**
 * Prose symbols and what stands for them where they cannot be shown: an old console prints them as `?`,
 * and a screen reader says "heavy multiplication x" for ✖. Only the symbols the tool writes between
 * words, with the spaces they are written with, so that a file called `a—b.ts` is left as it is.
 */
const PROSE: readonly (readonly [string, string])[] = [
    [' — ', ' - '],
    [' · ', ' | '],
    [' → ', ' -> '],
    [' ← ', ' <- '],
    ['…', '...'],
];

/** A text with its prose symbols written in ASCII. */
export function asciiProse(text: string): string {
    let result = text;
    for (const [symbol, replacement] of PROSE) {
        result = result.replaceAll(symbol, () => replacement);
    }
    return result;
}

/**
 * Cuts a text into lines of at most `width` columns at its spaces. The first line has `first` columns
 * used already by what comes before it, the others `hanging`. A word longer than the room stays whole
 * (a path is never cut), and with no `width` (a pipe) or too little room, nothing is cut.
 */
export function wrapWords(text: string, width: number | undefined, first: number, hanging: number): string[] {
    const MINIMUM = 24;
    if (width === undefined || width - Math.max(first, hanging) < MINIMUM) {
        return [text];
    }
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        const room = width - (lines.length === 0 ? first : hanging);
        if (line !== '' && line.length + 1 + word.length > room) {
            lines.push(line);
            line = word;
        } else {
            line = line === '' ? word : `${line} ${word}`;
        }
    }
    lines.push(line);
    return lines;
}
