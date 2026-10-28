import { shownName } from '../naming/modules.ts';
import { defineRule, HINT_FOR_SCHEMA, hintText } from './rule.ts';

/** A module of more files than this is pointed out by `explain`: it may be many things counted as one. */
const LARGE_MODULE = 10;

export interface MaxFilesOptions {
    readonly max: number;
    readonly count: 'files' | 'modules';
    readonly dotfiles: boolean;
    readonly filesPerModule: number;
    readonly hint: string;
    readonly hintFor: readonly string[];
}

export const maxFiles = defineRule<MaxFilesOptions>({
    meta: {
        description: 'A folder holds at most `max` files (or modules): past that it is scrolled, not read.',
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/max-files.md',
        defaultOptions: { max: 20, count: 'files', dotfiles: false, filesPerModule: 0, hint: '', hintFor: [] },
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
                hint: {
                    type: 'string',
                    description: 'Added to the message: how to split in this ecosystem, or what a new folder costs.',
                },
                hintFor: HINT_FOR_SCHEMA,
                dotfiles: {
                    type: 'boolean',
                    description:
                        'Whether files whose name starts with a dot count. Default: false — they are mostly tool settings (.gitignore, .editorconfig) that have to live where the tool looks.',
                },
            },
        },
    },
    check(folder, { options, report, note }) {
        // Files that describe the folder or go with a sibling folder are not one more thing in it.
        const uncounted = new Set(folder.uncounted?.map(entry => entry.file));
        const counted = folder.files.filter(
            name => !uncounted.has(name) && (options.dotfiles || !name.startsWith('.')),
        );
        let measured = counted.length;
        if (options.count === 'modules') {
            measured = 0;
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
        }
        if (measured <= options.max) {
            return;
        }
        const unit = options.count === 'modules' ? 'modules' : 'files';
        report({
            message: `${measured} ${unit}, over the limit of ${options.max}: split it into folders by what the files are about.${hintText(options.hint, options.hintFor, counted)}`,
            measured,
            limit: options.max,
            files: counted,
        });
    },
});
