import { compileGlob } from '../paths/glob.ts';
import { joinPath } from '../paths/tree.ts';
import { defineRule } from './rule.ts';

export interface SingleFileFoldersOptions {
    readonly allowed: readonly string[];
}

export const singleFileFolders = defineRule<SingleFileFoldersOptions>({
    meta: {
        description:
            'A folder that holds one file and no subfolders is a level of nesting with nothing to group: keep the file in its parent until it has company. The other side of `max-files`, for those who split too early.',
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/single-file-folders.md',
        defaultOptions: { allowed: [] },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                allowed: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    description:
                        'Globs of files that may be alone in their folder because something outside requires it: `main.go` of a Go command, `lib.rs` of a crate. Matched like `exclude`: a pattern without "/" is a file name at any depth, one with "/" is a path from the root.',
                },
            },
        },
    },
    check(folder, { options, report }) {
        if (folder.path === '.' || folder.folders.length > 0 || folder.files.length !== 1) {
            return;
        }
        const only = folder.files[0] ?? '';
        const path = joinPath(folder.path, only);
        if (options.allowed.some(pattern => compileGlob(pattern).test(path))) {
            return;
        }
        report({
            message: `holds only ${only === '' ? 'one file' : only}: a folder with nothing to group is one more level to open.`,
            measured: 1,
            limit: 0,
            files: folder.files,
        });
    },
});
