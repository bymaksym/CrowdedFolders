import { docsUrl } from '../docs-url.ts';
import { compareText } from '../naming/modules.ts';
import { defineRule } from './rule.ts';

// No options; the empty object is what the rule's options are.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a rule without options still has an options type
export interface CaseCollisionOptions {}

export const caseCollision = defineRule<CaseCollisionOptions>({
    meta: {
        description:
            'Two files or folders of one folder whose names differ only in case or in Unicode normalisation (`Components/` and `components/`, `Foo.ts` and `foo.ts`, `café` written two ways) are one name on Windows and macOS: git cannot check both out there, and one silently overwrites the other.',
        url: docsUrl('rules/case-collision.md'),
        defaultOptions: {},
        options: { type: 'object', additionalProperties: false, properties: {} },
    },
    check(folder, { report }) {
        const byName = new Map<string, { names: string[]; files: string[] }>();
        const add = (name: string, isFile: boolean): void => {
            const id = name.normalize('NFC').toLowerCase();
            let entry = byName.get(id);
            if (!entry) {
                entry = { names: [], files: [] };
                byName.set(id, entry);
            }
            entry.names.push(isFile ? name : `${name}/`);
            if (isFile) {
                entry.files.push(name);
            }
        };
        for (const name of folder.files) {
            add(name, true);
        }
        for (const name of folder.folders) {
            add(name, false);
        }
        for (const [id, { names, files }] of byName) {
            if (names.length < 2) {
                continue;
            }
            const sorted = names.toSorted(compareText);
            // `café` typed on macOS (NFD) and elsewhere (NFC) look the same; say why they collide.
            const isUnicode = new Set(names.map(name => name.toLowerCase())).size > 1;
            const how = isUnicode
                ? 'are the same letters written two ways in Unicode (NFC and NFD), one name on macOS'
                : 'are one name on a disk that ignores case (Windows, macOS)';
            report({
                message: `${sorted.map(name => `"${name}"`).join(' and ')} ${how}: git cannot check them out side by side there. Rename one, or join them.`,
                key: id,
                measured: names.length,
                limit: 1,
                files,
            });
        }
    },
});
