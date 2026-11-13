import { docsUrl } from '../docs-url.ts';
import { shownName } from '../naming/modules.ts';
import { splitWords } from '../naming/words.ts';
import { plural } from '../plural.ts';
import { planMoves, repeatedWords, staysInPlace, withoutPrefix } from './moves.ts';
import { defineRule, listNames } from './rule.ts';

export interface RedundantPrefixOptions {
    readonly min: number;
}

export const redundantPrefix = defineRule<RedundantPrefixOptions>({
    meta: {
        description:
            "Modules inside a folder do not repeat the folder's name: `render/render-json.ts` says render twice; `render/json.ts` says it once. A module named exactly like its folder (`render/render.ts`) is its main file and is fine.",
        url: docsUrl('rules/redundant-prefix.md'),
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
    check(folder, { options, report, note, existing }) {
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
        const names = (modules: typeof repeating): string => listNames(modules.map(shownName));
        if (folder.naming.routes) {
            note?.({
                message: `${names(repeating)} repeat the folder's name "${folder.name}", but here a file's path is its address (naming.routes): a shorter name would change it`,
            });
            return;
        }
        // A name a tool reads (naming.keepInPlace) is not the author's to shorten.
        const kept = repeating.filter(module => staysInPlace(module, folder.path, folder.naming));
        const renamed = repeating.filter(module => !kept.includes(module));
        if (kept.length > 0 && renamed.length < options.min) {
            note?.({
                message: `${names(kept)} repeat the folder's name "${folder.name}", but a tool reads them by that name (naming.keepInPlace)`,
            });
            return;
        }
        const plan = planMoves(
            renamed,
            folder.path,
            folder.path,
            (file, module) => withoutPrefix(file, module, prefix),
            existing,
        );
        report({
            message: `${plural(renamed.length, 'module')} repeat the folder's name "${folder.name}" (${names(renamed)}): the folder already says it.${plan.notes.map(sentence => ` ${sentence}`).join('')}`,
            measured: renamed.length,
            limit: options.min - 1,
            files: renamed.flatMap(module => module.files),
            moves: plan.moves,
        });
    },
});
