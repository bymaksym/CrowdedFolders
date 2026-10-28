/** Control characters, and the ones that reorder text on screen (bidi overrides and isolates). */
const UNSAFE = /[\p{Cc}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/**
 * Makes a name or a message safe to print: a control character becomes `\xNN` (`\uNNNN` above 0xFF).
 * A folder called `ctrl\x1b[31m` would otherwise recolour the terminal, and one with a line break would
 * invent a line of the report (or a workflow command on a log).
 */
export function safe(text: string): string {
    return text.replaceAll(UNSAFE, character => {
        const code = character.codePointAt(0) ?? 0;
        return code > 0xff ? `\\u${code.toString(16).padStart(4, '0')}` : `\\x${code.toString(16).padStart(2, '0')}`;
    });
}

/**
 * Takes the machine's folders out of a text: `C:\Users\me\repo\crowded-folders.config.json` is
 * `crowded-folders.config.json` for a root of `C:\Users\me\repo`. A report is pasted in pull requests.
 */
export function hidePaths(text: string, hide: readonly { readonly dir: string; readonly as: string }[]): string {
    let result = text;
    for (const { dir, as } of hide) {
        const forward = dir.replaceAll('\\', '/').replace(/\/+$/u, '');
        if (forward === '') {
            continue;
        }
        const bare = as.replace(/[/\\]+$/u, '') || '.';
        for (const variant of new Set([forward, forward.replaceAll('/', '\\')])) {
            const separator = variant.includes('\\') ? '\\' : '/';
            result = result.replaceAll(`${variant}${separator}`, () => as).replaceAll(variant, () => bare);
        }
    }
    return result;
}
