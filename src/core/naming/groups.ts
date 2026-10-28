import { sameWord, singularsOf } from './inflect.ts';
import type { Module, Naming } from './modules.ts';
import { isNumericWord } from './words.ts';

/** How many leading words make a group key: a number, or `"auto"` for the longest prefix that keeps the group. */
export type GroupWords = number | 'auto';

/** The most words a key has, with `"auto"` too. */
export const MAX_KEY_WORDS = 4;

/**
 * The groups of one folder: modules by the first words of their subject, singular and plural read
 * as one word (`UsersController` is in the group `user` with `UserGroups` and `UserRoles`). The key
 * is written with the singular when the folder has it.
 *
 * With `words: "auto"`, a key grows one word at a time while one longer key keeps at least `min`
 * modules and more than half of the group: nine `Registro*` of which eight are `RegistroHorario*`
 * are the group `registro-horario`, and the ninth is left out. When the longer keys split the
 * group evenly (`user-list-*`, `user-card-*`), the shorter key is the better folder.
 *
 * Modules that belong to no group (a subject too short, a number) are left out.
 */
export function groupModules(
    modules: readonly Module[],
    words: GroupWords,
    min: number,
    naming: Pick<Naming, 'groupNumericPrefixes'>,
): Map<string, Module[]> {
    const length = words === 'auto' ? MAX_KEY_WORDS : words;
    const canonical = canonicalWords(modules, length);
    const keyOf = (module: Module, size: number): string | undefined => {
        if (module.subject.length < size) {
            return undefined;
        }
        if (!naming.groupNumericPrefixes && isNumericWord(module.subject[0] ?? '')) {
            return undefined;
        }
        return module.subject
            .slice(0, size)
            .map(word => canonical.get(word) ?? word)
            .join('-');
    };

    const groups = byKey(modules, module => keyOf(module, words === 'auto' ? 1 : words));
    if (words !== 'auto') {
        return groups;
    }
    const grown = new Map<string, Module[]>();
    for (const [key, members] of groups) {
        let current = { key, members };
        for (let size = 2; size <= MAX_KEY_WORDS && current.members.length >= min; size++) {
            const longer = [...byKey(current.members, module => keyOf(module, size))].toSorted(
                ([, a], [, b]) => b.length - a.length,
            );
            const [best] = longer;
            if (best === undefined || best[1].length < min || best[1].length * 2 <= current.members.length) {
                break;
            }
            current = { key: best[0], members: best[1] };
        }
        grown.set(current.key, current.members);
    }
    return grown;
}

/**
 * For every word that appears in the first `length` words of a subject, the spelling that stands
 * for it: the singular, when the folder also has it (`users` → `user`).
 */
function canonicalWords(modules: readonly Module[], length: number): Map<string, string> {
    const present = new Set<string>();
    for (const module of modules) {
        for (const word of module.subject.slice(0, length)) {
            present.add(word);
        }
    }
    const canonical = new Map<string, string>();
    for (const word of present) {
        const singular = singularsOf(word).find(
            candidate => candidate !== word && present.has(candidate) && sameWord(candidate, word),
        );
        if (singular !== undefined) {
            canonical.set(word, singular);
        }
    }
    return canonical;
}

function byKey(modules: readonly Module[], keyOf: (module: Module) => string | undefined): Map<string, Module[]> {
    const groups = new Map<string, Module[]>();
    for (const module of modules) {
        const key = keyOf(module);
        if (key === undefined) {
            continue;
        }
        const members = groups.get(key);
        if (members) {
            members.push(module);
        } else {
            groups.set(key, [module]);
        }
    }
    return groups;
}

/** Whether a key is one of `keys`, reading singular and plural as one word: `tests` is in `["test"]`. */
export function keyIn(key: string, keys: readonly string[]): boolean {
    const words = key.split('-');
    return keys.some(other => {
        const otherWords = other.split('-');
        return (
            otherWords.length === words.length && otherWords.every((word, index) => sameWord(word, words[index] ?? ''))
        );
    });
}
