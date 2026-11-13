import { mergeOptions } from '../config/merge.ts';
import type { RuleState } from '../config/types.ts';
import type { FolderStat } from '../findings.ts';
import { shownName } from '../naming/modules.ts';
import type { FolderEntry } from '../paths/tree.ts';
import { defineRule, type FolderView, HINT_FOR_SCHEMA, hintText, type Note, type Rule } from './rule.ts';

/** A module of more files than this is pointed out by `explain`: it may be many things counted as one. */
const LARGE_MODULE = 10;

export interface MaxFilesOptions {
    readonly max: number;
    readonly count: 'files' | 'modules';
    readonly dotfiles: boolean;
    readonly filesPerModule: number;
    readonly warnAbove: number;
    readonly hint: string;
    readonly hintFor: readonly string[];
}

export const maxFiles = defineRule<MaxFilesOptions>({
    meta: {
        description: 'A folder holds at most `max` files (or modules): past that it is scrolled, not read.',
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/max-files.md',
        defaultOptions: {
            max: 20,
            count: 'files',
            dotfiles: false,
            filesPerModule: 0,
            warnAbove: 0,
            hint: '',
            hintFor: [],
        },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                max: { type: 'integer', minimum: 1, description: 'How many it may hold.' },
                count: {
                    enum: ['files', 'modules'],
                    description:
                        '"files" counts every file; "modules" counts a module and its companions once (`foo.ts`, `foo.spec.ts`, `foo.html` are one).',
                },
                filesPerModule: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'With count "modules", a module of more files than this counts once for every this many: 25 View+X.swift extensions folded into View count as 5 with 5. Default: 0, a module counts once however many files it has.',
                },
                warnAbove: {
                    type: 'integer',
                    minimum: 0,
                    description:
                        'A second, lower limit: a folder over it and within `max` is a warning, and only over `max` does it take the severity of the rule. { "max": 20, "warnAbove": 10 } fails CI at 21 and still shows the folders past 10. Default: 0, no second limit.',
                },
                hint: {
                    type: 'string',
                    description: 'Added to the message: how to split in this ecosystem, or what a new folder costs.',
                },
                hintFor: HINT_FOR_SCHEMA,
                dotfiles: {
                    type: 'boolean',
                    description:
                        'Whether files whose name starts with a dot count. Default: false — they are mostly tool settings (.gitignore, .editorconfig) that have to live where the tool looks. recommended leaves every dot-file out with ".*" in exclude, so for true to see them, exclude only the dot-folders: "exclude": ["!.*", ".*/"].',
                },
            },
        },
    },
    check(folder, { options, report, note }) {
        const { measured, counted } = measureFolder(folder, options, note);
        const warns = options.warnAbove > 0 && options.warnAbove < options.max && measured > options.warnAbove;
        if (measured <= options.max && !warns) {
            return;
        }
        const unit = options.count === 'modules' ? 'modules' : 'files';
        const over =
            measured > options.max
                ? `over the limit of ${options.max}`
                : `over the warning limit of ${options.warnAbove} (the limit is ${options.max})`;
        report({
            message: `${measured} ${unit}, ${over}: split it into folders by what the files are about.${hintText(options.hint, options.hintFor, counted)}`,
            measured,
            limit: measured > options.max ? options.max : options.warnAbove,
            files: counted,
            ...(measured <= options.max && { severity: 'warn' as const }),
        });
    },
});

/**
 * What `max-files` counts in a folder, in the unit it is set to: the one measure the rule fails on and
 * `--stats` reports, so that "over the limit" means the same in both. Files that describe the folder or
 * go with a sibling folder are not one more thing in it.
 */
export function measureFolder(
    folder: FolderView,
    options: Pick<MaxFilesOptions, 'count' | 'dotfiles' | 'filesPerModule'>,
    note?: (note: Note) => void,
): { readonly measured: number; readonly counted: string[] } {
    const uncounted = new Set(folder.uncounted?.map(entry => entry.file));
    const counted = folder.files.filter(name => !uncounted.has(name) && (options.dotfiles || !name.startsWith('.')));
    if (options.count !== 'modules') {
        return { measured: counted.length, counted };
    }
    let measured = 0;
    for (const module of folder.modules) {
        const files = module.files.filter(name => options.dotfiles || !name.startsWith('.')).length;
        if (files === 0) {
            continue;
        }
        measured += options.filesPerModule > 0 ? Math.ceil(files / options.filesPerModule) : 1;
        if (note && files > LARGE_MODULE && options.filesPerModule === 0) {
            note({
                key: module.stem,
                message: `${shownName(module)} is ${files} files counted as one module: if they are ${files} things (View+Layout.swift, View+Style.swift…), set max-files' filesPerModule, or narrow naming.companions`,
            });
        }
    }
    return { measured, counted };
}

/** The numbers of a folder for `--stats`: what it holds, and what `max-files` makes of it where that rule is on. */
export function folderStat(
    entry: FolderEntry,
    view: FolderView,
    state: RuleState | undefined,
    rule: Rule | undefined,
): FolderStat {
    const options =
        state && rule && state.severity !== 'off'
            ? (mergeOptions(
                  rule.meta.defaultOptions as Record<string, unknown>,
                  state.options,
              ) as unknown as MaxFilesOptions)
            : undefined;
    return {
        path: entry.path,
        modules: view.modules.length,
        files: entry.files.length,
        subfolders: entry.folders.length,
        limit: typeof options?.max === 'number' ? options.max : null,
        // What the rule itself counts, so that "over the limit" here is what the rule reports.
        unit: options?.count === 'files' ? 'files' : 'modules',
        used: options === undefined ? view.modules.length : measureFolder(view, options).measured,
    };
}
