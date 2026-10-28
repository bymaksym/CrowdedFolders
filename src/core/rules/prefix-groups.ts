import { groupModules, type GroupWords, keyIn, MAX_KEY_WORDS } from '../naming/groups.ts';
import { isLanguageTag } from '../naming/languages.ts';
import { keyRestatesPath, type Module, shownName } from '../naming/modules.ts';
import { isNumericWord, splitWords } from '../naming/words.ts';
import { joinPath } from '../paths/tree.ts';
import {
    defineRule,
    HINT_FOR_SCHEMA,
    hintText,
    listNames,
    type Move,
    type OptionProblem,
    type RuleContext,
} from './rule.ts';

export interface PrefixGroupsOptions {
    readonly min: number;
    readonly words: GroupWords;
    readonly ignore: readonly string[];
    readonly hint: string;
    readonly hintFor: readonly string[];
}

/**
 * A group that holds this share of the folder's modules or more is what the folder is about, not a
 * group inside it: moving 92 of 93 files one level down only adds a level (and the new folder is as
 * crowded as the old one).
 */
const SUBJECT_SHARE = 0.85;

export const prefixGroups = defineRule<PrefixGroupsOptions>({
    meta: {
        description:
            'At least `min` modules whose names start with the same word belong in a folder named after it: `render-json`, `render-text`, `render-sarif`, `render-pr` are a `render/` folder that was never made.',
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/prefix-groups.md',
        defaultOptions: { min: 4, words: 1, ignore: [], hint: '', hintFor: [] },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                min: { type: 'integer', minimum: 2, description: 'How many modules sharing a prefix make a group.' },
                words: {
                    anyOf: [
                        { type: 'integer', minimum: 1, maximum: MAX_KEY_WORDS },
                        { const: 'auto', description: 'The longest prefix that keeps the group.' },
                    ],
                    description:
                        'How many leading words form the prefix: 1 groups `user-list` with `user-card`; 2 needs `user-list-*`; "auto" takes the longest prefix that still has `min` modules and more than half of the group (`RegistroHorario*` rather than `Registro*`).',
                },
                ignore: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    uniqueItems: true,
                    description:
                        'Prefixes that are never a group, lowercase, words joined with "-": a verb shared by unrelated files, or a convention such as `use`.',
                },
                hintFor: HINT_FOR_SCHEMA,
                hint: {
                    type: 'string',
                    description:
                        'Added to the message: what making a folder costs in this ecosystem ("In Go a folder is a package: …").',
                },
            },
        },
        checkOptions(options) {
            const problems: OptionProblem[] = [];
            const ignore = Array.isArray(options['ignore']) ? (options['ignore'] as unknown[]) : [];
            for (const [index, entry] of ignore.entries()) {
                if (typeof entry !== 'string') {
                    continue;
                }
                const prefix = entry.startsWith('!') ? entry.slice(1) : entry;
                const written = splitWords(prefix).join('-');
                if (written === '') {
                    problems.push({ at: `ignore[${index}]`, message: `"${entry}" has no words, so it never matches` });
                } else if (written !== prefix.toLowerCase()) {
                    problems.push({
                        at: `ignore[${index}]`,
                        message: `"${entry}" never matches: a prefix is written as its words, lowercase, joined with "-" — did you mean "${entry.startsWith('!') ? '!' : ''}${written}"?`,
                    });
                }
            }
            return problems;
        },
    },
    check(folder, { options, report, note, settingsOf }) {
        const groups = groupModules(folder.modules, options.words, options.min, folder.naming);
        const crowded = crowdedLimit(settingsOf);
        for (const [key, modules] of groups) {
            const reason = whyNotReported(key, modules, folder, options, crowded);
            if (reason !== undefined) {
                // A module alone is not a group anyone asks about.
                if (note && modules.length >= 2) {
                    note({ key, message: `"${key}" (${listNames(modules.map(shownName))}): ${reason}` });
                }
                continue;
            }
            const target = joinPath(folder.path, key);
            const moves: Move[] = modules.flatMap(module =>
                module.files.map(file => ({ from: joinPath(folder.path, file), to: joinPath(target, file) })),
            );
            const files = modules.flatMap(module => module.files);
            const hint = hintText(options.hint, options.hintFor, files);
            report({
                message: `${modules.length} modules start with "${key}" (${listNames(modules.map(shownName))}): they are a folder that was never made — ${target}/.${hint}`,
                key,
                measured: modules.length,
                limit: options.min - 1,
                files,
                moves,
            });
        }
    },
});

interface CrowdedLimit {
    readonly max: number;
    readonly count: 'files' | 'modules';
    readonly dotfiles: boolean;
}

/** The limit of `max-files` in this folder, when it is on: a folder made of a group must not break it. */
function crowdedLimit(settingsOf: RuleContext<object>['settingsOf']): CrowdedLimit | undefined {
    const options = settingsOf?.('max-files')?.options;
    if (!options || typeof options['max'] !== 'number') {
        return undefined;
    }
    return {
        max: options['max'],
        count: options['count'] === 'files' ? 'files' : 'modules',
        dotfiles: options['dotfiles'] === true,
    };
}

/** Why a group is not reported, or `undefined` when it is. The order is the order `explain` reasons in. */
function whyNotReported(
    key: string,
    modules: readonly Module[],
    folder: {
        readonly path: string;
        readonly modules: readonly Module[];
        readonly naming: { readonly groupNumericPrefixes: boolean };
    },
    options: PrefixGroupsOptions,
    crowded: CrowdedLimit | undefined,
): string | undefined {
    if (keyIn(key, options.ignore)) {
        return "the prefix is in prefix-groups' ignore";
    }
    if (modules.length < options.min) {
        return `${modules.length} modules, and ${options.min} make a group (min)`;
    }
    const words = key.split('-').length;
    const total = folder.modules.length;
    if (modules.length === total) {
        return "every module of the folder starts with it: it is the folder's subject, not a group inside it — name the folder after it, or drop it from the names";
    }
    if (modules.length >= total * SUBJECT_SHARE) {
        return `${modules.length} of the folder's ${total} modules start with it (${Math.round(SUBJECT_SHARE * 100)} % or more): it is the folder's subject, not a group inside it — name the folder after it, or drop it from the names`;
    }
    if (keyRestatesPath(key, folder.path, modules)) {
        return `it restates the folder's path (${folder.path}): they are already where they belong`;
    }
    if (areTranslations(modules, words)) {
        return 'the rest of each name is a language: one thing in several languages, not a family of topics';
    }
    if (!folder.naming.groupNumericPrefixes && isNumberedSeries(modules, words)) {
        return 'they are a numbered series (prefix, number, title), kept flat and in order';
    }
    if (crowded) {
        const size =
            crowded.count === 'modules'
                ? modules.length
                : modules.flatMap(module => module.files).filter(file => crowded.dotfiles || !file.startsWith('.'))
                      .length;
        if (size > crowded.max) {
            return `${size} ${crowded.count}: a folder made of them would be over max-files' limit of ${crowded.max} on its own — group them by more words (prefix-groups words: 2, or "auto")`;
        }
    }
    return undefined;
}

/**
 * Whether a group is one thing in several languages: `README-ja`, `README-ko`, `README-ru` (bat), or
 * the `strings_ar` … `strings_zh` that slang generates (localsend). What follows the prefix is a
 * language tag in every module but the untranslated one.
 */
function areTranslations(modules: readonly Module[], words: number): boolean {
    const rests = modules.map(module => module.subject.slice(words)).filter(rest => rest.length > 0);
    return rests.length >= modules.length - 1 && rests.every(rest => isLanguageTag(rest));
}

/**
 * Whether a group is a numbered series: every module is the prefix, a number and a title, as
 * `ADR-001-Use-EFCore-In-Application-Layer` (jasontaylordev/CleanArchitecture) or `RFC-0042-async-io`.
 * Such a series is kept flat and in order, like migrations; `x-1`, `x-2` without a title, or a
 * group where only `SM_1MeterSphere` has a number, are still groups.
 */
function isNumberedSeries(modules: readonly Module[], words: number): boolean {
    return modules.every(
        module =>
            isNumericWord(module.subject[words] ?? '') &&
            module.subject.length > words + 1 &&
            !isNumericWord(module.subject[words + 1] ?? ''),
    );
}
