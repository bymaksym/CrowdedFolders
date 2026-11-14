import { docsUrl } from '../docs-url.ts';
import { groupModules, type GroupWords, keyIn, MAX_KEY_WORDS } from '../naming/groups.ts';
import { isLanguageTag } from '../naming/languages.ts';
import { keyRestatesPath, type Module, shownName } from '../naming/modules.ts';
import { isNumericWord, splitWords } from '../naming/words.ts';
import { joinPath } from '../paths/tree.ts';
import { existingFolder, folderNameFor, planMoves, staysInPlace, withoutPrefix } from './moves.ts';
import { defineRule, HINT_FOR_SCHEMA, hintText, listNames, type OptionProblem, type RuleContext } from './rule.ts';

export interface PrefixGroupsOptions {
    readonly min: number;
    readonly words: GroupWords;
    readonly ignore: readonly string[];
    readonly hint: string;
    readonly hintFor: readonly string[];
    readonly dropPrefix: boolean;
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
        url: docsUrl('rules/prefix-groups.md'),
        defaultOptions: { min: 4, words: 1, ignore: [], hint: '', hintFor: [], dropPrefix: true },
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
                dropPrefix: {
                    type: 'boolean',
                    description:
                        'Whether a move drops the prefix the new folder already says: render-json.ts goes to render/json.ts, as redundant-prefix asks. False where a file is named after the type it holds (a Java or C# class, a Unity script): renaming the file would rename the type. Default: true.',
                },
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
    check(folder, { options, report, note, settingsOf, existing }) {
        const groups = groupModules(folder.modules, options.words, options.min, folder.naming);
        const crowded = crowdedLimit(settingsOf);
        for (const [key, grouped] of groups) {
            // What a tool reads by name and place cannot move, so it is not part of a group to move.
            const kept = grouped.filter(module => staysInPlace(module, folder.path, folder.naming));
            const modules = grouped.filter(module => !kept.includes(module));
            const reason =
                kept.length > 0 && modules.length < options.min
                    ? `${listNames(kept.map(shownName))} must stay where ${kept.length === 1 ? 'it is' : 'they are'} (naming.keepInPlace: a tool reads them by name and place), and the other ${modules.length} are fewer than the ${options.min} that make a group (min)`
                    : whyNotReported(key, modules, folder, options, crowded);
            if (reason !== undefined) {
                // A module alone is not a group anyone asks about.
                if (note && grouped.length >= 2) {
                    note({ key, message: `"${key}" (${listNames(grouped.map(shownName))}): ${reason}` });
                }
                continue;
            }
            const files = modules.flatMap(module => module.files);
            const hint = hintText(options.hint, options.hintFor, files);
            const opening = `${modules.length} modules start with "${key}" (${listNames(modules.map(shownName))})`;
            const words = key.split('-');
            const folderName = folderNameFor(words, folder.naming);
            if (folderName.name === undefined) {
                report({
                    message: `${opening}: they are a folder that was never made, but "${folderName.reserved ?? key}" and its plural are reserved words in this language — name the folder yourself.${hint}`,
                    key,
                    measured: modules.length,
                    limit: options.min - 1,
                    files,
                    moves: [],
                });
                continue;
            }
            const routes = folder.naming.routes === true;
            const there = existingFolder(folderName.name, folder.folders, routes);
            const target = joinPath(folder.path, there ?? folderName.name);
            // Rust: render.rs declares the module whose files go in render/, so it stays beside it.
            const staying = folder.naming.groupFileStays
                ? modules.filter(module => module.subject.length === words.length)
                : [];
            // Under routes a name is an address: shortening it would change it.
            const shorten = options.dropPrefix && !routes;
            const plan = planMoves(
                modules.filter(module => !staying.includes(module)),
                folder.path,
                target,
                (file, module) => (shorten ? withoutPrefix(file, module, words) : undefined),
                existing,
            );
            const where =
                there === undefined
                    ? `they are a folder that was never made — ${target}/`
                    : `move them into the ${target}/ that already exists`;
            const reserved = folderName.reserved === undefined ? '' : ` ("${folderName.reserved}" is a reserved word)`;
            const after = [
                ...(staying.length > 0
                    ? [
                          `${listNames(staying.flatMap(module => module.files))} stays beside it and declares what is in it.`,
                      ]
                    : []),
                ...(kept.length > 0
                    ? [`${listNames(kept.map(shownName))} stay where they are (naming.keepInPlace).`]
                    : []),
                ...plan.notes,
                ...(options.dropPrefix || routes || plan.moves.length === 0 || !settingsOf?.('redundant-prefix')
                    ? []
                    : [
                          `The names keep "${key}" (dropPrefix: false), and redundant-prefix, on here, would then ask to drop it: set dropPrefix: true to move them shortened, or turn redundant-prefix off where a name repeats its folder on purpose.`,
                      ]),
            ];
            report({
                message: `${opening}: ${where}${reserved}.${after.map(sentence => ` ${sentence}`).join('')}${hint}${letterHint(key)}`,
                key,
                measured: modules.length,
                limit: options.min - 1,
                files,
                moves: plan.moves,
            });
        }
    },
});

/**
 * A prefix of one letter is rarely a word: it is a convention that marks the name (`x-order`, `x-invoice` with a
 * product code). Say which setting skips it, because `rules` and `explain` are where that
 * setting is found otherwise.
 */
function letterHint(key: string): string {
    return /^\p{L}$/u.test(key)
        ? ` "${key}" is one letter: if it marks the name and says nothing about what the file is, naming.ignoreLeadingWords: ["${key}"] skips it (crowded-folders rules naming).`
        : '';
}

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
    // Written "Render" or "render": checkOptions accepts both, so both match, as ignoreLeadingWords does.
    if (keyIn(key, options.ignore.map(prefix => prefix.toLowerCase()))) {
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
