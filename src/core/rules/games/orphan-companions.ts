import { docsUrl } from '../../docs-url.ts';
import { caseless } from '../moves.ts';
import { defineRule, listNames } from '../rule.ts';

export interface OrphanCompanionsOptions {
    readonly suffixes: readonly string[];
    readonly emptyFolders: boolean;
}

export const orphanCompanions = defineRule<OrphanCompanionsOptions>({
    meta: {
        description:
            "A file an engine keeps next to an asset (Unity's `Player.cs.meta`, Godot's `icon.png.import` and `player.gd.uid`) has its asset beside it. One without it is what is left when the asset was moved, renamed or deleted outside the editor, or committed without it: the ID it held is gone, and every reference to the asset breaks.",
        url: docsUrl('rules/orphan-companions.md'),
        defaultOptions: { suffixes: ['.meta', '.import', '.uid'], emptyFolders: false },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                suffixes: {
                    type: 'array',
                    items: { type: 'string', minLength: 2, pattern: String.raw`^!?\.[^./]+$` },
                    uniqueItems: true,
                    description:
                        'The endings of the files that go with an asset, each a dot and a word: `X.meta` goes with the file or folder `X`. "!.uid" takes one out.',
                },
                emptyFolders: {
                    type: 'boolean',
                    description:
                        "Whether to report a companion of a folder that is not there (`Glade.meta` with no `Glade/`). Git stores no empty folder, so an empty folder's `.meta` is committed alone, and Unity makes the folder again when it sees it. Default: false. A companion of a name without an extension is taken for a folder's.",
                },
            },
        },
    },
    check(folder, { options, report, note, inRepository }) {
        const names = new Set([...folder.files, ...folder.folders]);
        const byCase = new Map([...names].map(name => [caseless(name), name] as const));
        const orphans: string[] = [];
        const inCase: string[] = [];
        for (const file of folder.files) {
            const suffix = options.suffixes.find(ending => file.endsWith(ending) && file.length > ending.length);
            if (suffix === undefined) {
                continue;
            }
            const asset = file.slice(0, -suffix.length);
            const path = folder.path === '.' ? asset : `${folder.path}/${asset}`;
            if (names.has(asset) || inRepository?.(path) === true) {
                continue;
            }
            if (!options.emptyFolders && !asset.includes('.')) {
                note?.({
                    key: file,
                    message: `${file} has no ${asset}/ next to it: an empty folder, which git does not store (emptyFolders: true reports it)`,
                });
                continue;
            }
            const other = byCase.get(caseless(asset));
            if (other === undefined) {
                orphans.push(file);
            } else {
                inCase.push(`${file} (next to ${other})`);
                orphans.push(file);
            }
        }
        if (orphans.length === 0) {
            return;
        }
        const assets = orphans.length === 1 ? 'its asset' : 'their assets';
        const caseNote =
            inCase.length === 0
                ? ''
                : ` ${listNames(inCase)} ${inCase.length === 1 ? 'differs' : 'differ'} only in case, which Linux and git tell apart.`;
        report({
            message: `${listNames(orphans)} ${orphans.length === 1 ? 'is' : 'are'} without ${assets}: the asset was moved, renamed or deleted outside the editor, or never committed. Move ${orphans.length === 1 ? 'it' : 'them'} with ${assets}, or delete ${orphans.length === 1 ? 'it' : 'them'} if the asset is gone.${caseNote}`,
            measured: orphans.length,
            limit: 0,
            files: orphans,
        });
    },
});
