import { docsUrl } from '../../docs-url.ts';
import { sameWord } from '../../naming/inflect.ts';
import { splitWords } from '../../naming/words.ts';
import { defineRule } from '../rule.ts';

export interface TypeFoldersOptions {
    readonly names: readonly string[];
    readonly hint: string;
}

export const typeFolders = defineRule<TypeFoldersOptions>({
    meta: {
        description:
            'A folder is named after what its assets are for, not what type they are: `Rocks/` holds the mesh, textures and materials of the rocks, where `Textures/`, `Materials/` and `Meshes/` spread one rock over three folders. For game engines, whose editors already filter by type.',
        url: docsUrl('rules/type-folders.md'),
        // Allar's UE5 style guide, 2.6: "Do Not Create Folders Called Assets or AssetTypes", and
        // 2.6.2 names Meshes, Textures and Materials. Animations and audio are its exception (2.7).
        defaultOptions: { names: ['assets', 'meshes', 'textures', 'materials'], hint: '' },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                names: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    uniqueItems: true,
                    description:
                        'Folder names that are an asset type, in any case, singular or plural: `textures` matches `Textures/` and `texture/`, not `MaterialLibrary/`.',
                },
                hint: { type: 'string', description: "Added to the message: the guide's words, where they come from." },
            },
        },
    },
    check(folder, { options, report }) {
        if (folder.path === '.') {
            return;
        }
        const words = splitWords(folder.name);
        const named = options.names.find(name => {
            const type = splitWords(name);
            return type.length === words.length && type.every((word, index) => sameWord(word, words[index] ?? ''));
        });
        if (named === undefined) {
            return;
        }
        report({
            message: `"${folder.name}" is named after the type of its assets, not what they are for: put each next to what uses it (Rocks/ with its mesh, textures and materials), where the editor's type filter finds it.${options.hint === '' ? '' : ` ${options.hint}`}`,
            measured: 1,
            limit: 0,
            files: folder.files,
        });
    },
});
