/** The words of a stem, and where each one starts in it. */
export interface ReadName {
    /** Lowercase: `['i', 'user', 'service']`. */
    readonly words: readonly string[];
    /** Where each word starts and ends in the stem, NFC-normalised, in UTF-16 offsets. */
    readonly spans: readonly (readonly [start: number, end: number])[];
    /**
     * Whether the first word is a single capital glued to a capitalised word: the `I` of `IUserService`
     * and `II18nKey`, the `T` of `TProps`, the `E` of `EColor`, the `A` and `U` of Unreal's `AActor`
     * and `UObject`. Such a letter marks what kind of thing the file holds, not what it is about.
     */
    readonly typePrefix: boolean;
}

/**
 * Brand and platform names whose capitals are not word starts: `OAuthClient` is `oauth`, `client`,
 * not a group `o`; `iOSApp` is `ios`, `app`. Longest first, so `iPadOS` wins over `iPad`. The first
 * letter may be either case (`MacOS`); the rest must be as written, so `OAUTH_TOKEN` stays an acronym.
 */
const COMPOUNDS: readonly string[] = [
    'OAuth',
    'iOS',
    'iPadOS',
    'macOS',
    'tvOS',
    'watchOS',
    'visionOS',
    'iPhone',
    'iPad',
    'iCloud',
    'eBay',
    'jQuery',
    'GraphQL',
    'IPv4',
    'IPv6',
    'CMake',
    'SQLite',
    'JUnit',
].toSorted((a, b) => b.length - a.length);

/**
 * Splits a file stem into lowercase words, whatever the convention it was written in:
 * `user-service`, `user_service`, `userService`, `UserService` and `USER_SERVICE` all give
 * `['user', 'service']`, and `HTTPServer` gives `['http', 'server']`.
 *
 * Digits stay attached to the letters around them (`i18n`, `e1000`, `vector3`): splitting there
 * would turn `i18n-utils` into a group called `i`. A run of digits on its own (`2024-01-01-post`)
 * is a word of its own, which is how numbered and dated files are recognised later; a dot between
 * digits keeps a version whole (`v1.2.3`).
 *
 * One pass over the characters, no regular expression with alternatives: it runs on every file of
 * the repository.
 */
export function splitWords(stem: string): string[] {
    return [...readName(stem).words];
}

/** {@link splitWords}, with where each word is and whether the name starts with a type letter. */
export function readName(stem: string): ReadName {
    const text = stem.normalize('NFC');
    const words: string[] = [];
    const spans: [number, number][] = [];
    // Code points, not UTF-16 units: a letter outside the BMP is one character. Grapheme clusters
    // (an emoji with a modifier) do not matter here: they are never part of a word.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are what is wanted
    const chars = [...text];
    const offsets: number[] = [];
    let offset = 0;
    for (const char of chars) {
        offsets.push(offset);
        offset += char.length;
    }
    offsets.push(offset);

    let current = '';
    let start = 0;
    // The words of a compound end with it: `OAuthAPI` is `oauth`, `api`.
    let afterCompound = false;

    const flush = (end: number): void => {
        if (current === '') {
            return;
        }
        // `İ` lowercases to `i` and a combining dot; the dot says nothing.
        words.push(current.toLowerCase().replaceAll('i̇', 'i'));
        spans.push([offsets[start] ?? 0, offsets[end] ?? 0]);
        current = '';
    };

    for (let index = 0; index < chars.length; index++) {
        const char = chars[index] ?? '';
        const previous = chars[index - 1] ?? '';
        const next = chars[index + 1] ?? '';
        if (!isWordChar(char)) {
            // 1.2.3: a dot between digits is part of the number.
            if (char === '.' && current !== '' && isDigit(previous) && isDigit(next)) {
                current += char;
                continue;
            }
            flush(index);
            afterCompound = false;
            continue;
        }
        let startsWord = current === '';
        if (!startsWord && isUpper(char)) {
            startsWord = afterCompound || splitsBefore(chars, index);
        }
        afterCompound = false;
        if (startsWord) {
            flush(index);
            start = index;
            const compound = compoundAt(chars, index);
            if (compound !== undefined) {
                current = chars.slice(index, index + compound).join('');
                index += compound - 1;
                afterCompound = true;
                continue;
            }
        }
        current += char;
    }
    flush(chars.length);
    // One capital, and the next word glued to it with a capital: `I_Foo` and `I-Foo` are words, and
    // `X.cs` is about X.
    const [first, second] = spans;
    const typePrefix =
        first !== undefined &&
        second !== undefined &&
        first[1] - first[0] === 1 &&
        second[0] === first[1] &&
        isUpper(text[first[0]] ?? '') &&
        isUpper(text[second[0]] ?? '');
    return { words, spans, typePrefix };
}

/** Whether the capital at `index`, inside a word, starts a new one. */
function splitsBefore(chars: readonly string[], index: number): boolean {
    const previous = chars[index - 1] ?? '';
    // fooBar → foo | Bar
    if (isLower(previous) || isDigit(previous)) {
        return true;
    }
    if (!isUpper(previous)) {
        return false;
    }
    const next = chars[index + 1] ?? '';
    if (isLower(next)) {
        // getURLs, userIDs, APIs: a lowercase s after a run of capitals is the acronym's plural.
        // Otherwise, HTTPServer → HTTP | Server: the last capital of a run starts the next word.
        const afterNext = chars[index + 2] ?? '';
        return next !== 's' || isLower(afterNext) || isMark(afterNext);
    }
    // II18nKey → I | I18n | Key: a capital, digits and lowercase is a word, so the capital before it
    // is one of its own. MP3Player stays MP3 | Player: no lowercase after the digits.
    if (isDigit(next)) {
        let after = index + 1;
        while (isDigit(chars[after] ?? '')) {
            after++;
        }
        return isLower(chars[after] ?? '');
    }
    return false;
}

/** How many characters of a known compound start at `index`, if one does and ends a word there. */
function compoundAt(chars: readonly string[], index: number): number | undefined {
    for (const compound of COMPOUNDS) {
        if (index + compound.length > chars.length) {
            continue;
        }
        let matches = true;
        for (let offset = 0; offset < compound.length && matches; offset++) {
            const char = chars[index + offset] ?? '';
            const expected = compound[offset] ?? '';
            matches = offset === 0 ? char.toLowerCase() === expected.toLowerCase() : char === expected;
        }
        const after = chars[index + compound.length] ?? '';
        if (matches && !isLower(after) && !isMark(after)) {
            return compound.length;
        }
    }
    return undefined;
}

/** A word made only of digits, or of digits and the dots of a version: a date, an ordinal, `1.2.3`. */
export function isNumericWord(word: string): boolean {
    if (word === '') {
        return false;
    }
    for (const char of word) {
        if (!isDigit(char) && char !== '.') {
            return false;
        }
    }
    return true;
}

const UPPER = /^\p{Lu}$/u;
const LOWER = /^\p{Ll}$/u;
const DIGIT = /^\p{Nd}$/u;
const MARK = /^\p{M}$/u;
// Letters of any script, cased or not (`用户`, `пользователь`), the marks that combine with them
// (`हिन्दी`), and digits of any script.
const WORD = /^[\p{L}\p{M}\p{N}]$/u;

// ASCII first: almost every file name is ASCII, and a comparison is cheaper than a regular expression.
function isAscii(char: string): boolean {
    return char.length === 1 && char < '\u{80}';
}

function isUpper(char: string): boolean {
    return isAscii(char) ? char >= 'A' && char <= 'Z' : UPPER.test(char);
}

function isLower(char: string): boolean {
    return isAscii(char) ? char >= 'a' && char <= 'z' : LOWER.test(char);
}

/** A decimal digit of any script: `7`, `٧`, `७`. */
export function isDigit(char: string): boolean {
    return isAscii(char) ? char >= '0' && char <= '9' : DIGIT.test(char);
}

function isMark(char: string): boolean {
    return !isAscii(char) && char !== '' && MARK.test(char);
}

function isWordChar(char: string): boolean {
    return isAscii(char)
        ? (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9')
        : char !== '' && WORD.test(char);
}
