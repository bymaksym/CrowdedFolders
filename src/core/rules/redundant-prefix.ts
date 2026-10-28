import { sameWord } from '../naming/inflect.ts';
import { gluedWords, shownName } from '../naming/modules.ts';
import { readName, splitWords } from '../naming/words.ts';
import { joinPath } from '../paths/tree.ts';
import { plural } from '../plural.ts';
import { defineRule, listNames, type Move } from './rule.ts';

export interface RedundantPrefixOptions {
    readonly min: number;
}

export const redundantPrefix = defineRule<RedundantPrefixOptions>({
    meta: {
        description:
            "Modules inside a folder do not repeat the folder's name: `render/render-json.ts` says render twice; `render/json.ts` says it once. A module named exactly like its folder (`render/render.ts`) is its main file and is fine.",
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/redundant-prefix.md',
        defaultOptions: { min: 2 },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                min: {
                    type: 'integer',
                    minimum: 1,
                    description: 'How many modules have to repeat the name before it is reported: 1 reports every one.',
                },
            },
        },
    },
    check(folder, { options, report }) {
        if (folder.path === '.') {
            return;
        }
        // Singular and plural are one word: `categories/category-list.ts` and `children/child-row.ts`
        // repeat the folder; `news/new-a.ts` does not.
        const prefix = splitWords(folder.name);
        const repeating = folder.modules.filter(module => repeatedWords(module.subject, prefix) > 0);
        if (repeating.length < options.min) {
            return;
        }
        const moves: Move[] = [];
        for (const file of repeating.flatMap(module => module.files)) {
            const renamed = withoutPrefix(file, prefix);
            if (renamed !== undefined) {
                moves.push({ from: joinPath(folder.path, file), to: joinPath(folder.path, renamed) });
            }
        }
        report({
            message: `${plural(repeating.length, 'module')} repeat the folder's name "${folder.name}" (${listNames(repeating.map(shownName))}): the folder already says it.`,
            measured: repeating.length,
            limit: options.min - 1,
            files: repeating.flatMap(module => module.files),
            moves,
        });
    },
});

/**
 * The file name without the folder's name in front, keeping its own convention: `render-json.ts` →
 * `json.ts`, `RenderJson.cs` → `Json.cs`, `render_json_test.go` → `json_test.go`, `category-list.ts`
 * in `categories/` → `list.ts`. `undefined` when the name does not start with it (an ignored leading
 * word comes first, say).
 */
function withoutPrefix(file: string, prefix: readonly string[]): string | undefined {
    const name = file.normalize('NFC');
    const { words, spans } = readName(name);
    const repeated = repeatedWords(words, prefix);
    if (repeated === 0 || spans[0]?.[0] !== 0) {
        return undefined;
    }
    let rest = name.slice(spans[repeated - 1]?.[1] ?? 0);
    while (rest.startsWith('-') || rest.startsWith('_') || rest.startsWith(' ')) {
        rest = rest.slice(1);
    }
    return rest !== '' && !rest.startsWith('.') ? rest : undefined;
}

/**
 * How many leading words of `words` repeat the folder's words `prefix`, the plural allowed, with
 * something after them; 0 when they do not. A folder that glues its words (`dayplan`) is repeated by
 * `DayPlanList`: two words.
 */
function repeatedWords(words: readonly string[], prefix: readonly string[]): number {
    if (prefix.length === 0) {
        return 0;
    }
    if (words.length > prefix.length && prefix.every((word, index) => sameWord(words[index] ?? '', word))) {
        return prefix.length;
    }
    const glued = prefix.length === 1 ? gluedWords(words, prefix[0] ?? '') : 0;
    return glued > 1 && words.length > glued ? glued : 0;
}
