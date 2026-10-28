import type { FolderCase } from '../config/types.ts';
import { pluralsOf, sameWord } from '../naming/inflect.ts';
import { gluedWords, type Module, type Naming } from '../naming/modules.ts';
import { readName, splitWords } from '../naming/words.ts';
import { matchesSelfOrAncestor } from '../paths/glob.ts';
import { joinPath } from '../paths/tree.ts';
import type { Move, RuleContext } from './rule.ts';

/** Writes lowercase words as one name: `['user', 'list']` is `user-list`, `user_list`, `userList`, `UserList` or `userlist`. */
export function writeCase(words: readonly string[], folderCase: FolderCase): string {
    const capital = (word: string): string => (word === '' ? word : `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`);
    switch (folderCase) {
        case 'snake': {
            return words.join('_');
        }
        case 'camel': {
            return words.map((word, index) => (index === 0 ? word : capital(word))).join('');
        }
        case 'pascal': {
            return words.map(word => capital(word)).join('');
        }
        case 'lower': {
            return words.join('');
        }
        case 'kebab': {
            return words.join('-');
        }
    }
}

/** The folder a group goes into: its name, and the reserved word it avoided. */
export interface FolderName {
    /** `undefined` when every name it could take is reserved: the author names it. */
    readonly name: string | undefined;
    /** The name the group would have had, when the language reserves it (`abstract`). */
    readonly reserved: string | undefined;
}

/**
 * The name of the folder for a group's words, as this naming writes folders (`naming.folderCase`),
 * and never a word the language reserves (`naming.reservedWords`): `package com.a.core.abstract`
 * does not compile, so `abstract` becomes `abstracts`. Under routes it is a route group, `(sign)`.
 */
export function folderNameFor(words: readonly string[], naming: Naming): FolderName {
    const folderCase = naming.folderCase ?? 'kebab';
    const written = (name: string): string => (naming.routes ? `(${name})` : name);
    const plain = writeCase(words, folderCase);
    const reserved = naming.reservedWords;
    if (!reserved?.has(plain)) {
        return { name: written(plain), reserved: undefined };
    }
    for (const plural of preferredPlurals(words.at(-1) ?? '')) {
        const name = writeCase([...words.slice(0, -1), plural], folderCase);
        if (!reserved.has(name)) {
            return { name: written(name), reserved: plain };
        }
    }
    return { name: undefined, reserved: plain };
}

/** The plurals of a word, the likeliest first: `classes` before `classs`, `children` before `childs`. */
function preferredPlurals(word: string): string[] {
    const plurals = pluralsOf(word);
    const regular = `${word}s`;
    return plurals.toSorted((a, b) => Number(a === regular) - Number(b === regular));
}

/**
 * The subfolder of `folders` that already is the folder named `name`, written with other case, or
 * in the plural (`users/` for `user`): moving into it is better than making a second one. Under
 * routes only a route group counts: a plain `sign/` is an address.
 */
export function existingFolder(name: string, folders: readonly string[], routes: boolean): string | undefined {
    const words = splitWords(name);
    return words.length === 0
        ? undefined
        : folders.find(folder => folder.startsWith('(') === routes && sameWords(splitWords(folder), words));
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((word, index) => sameWord(word, b[index] ?? ''));
}

/**
 * How many leading words of `words` repeat `prefix`, the plural allowed, with something after
 * them; 0 when they do not. A folder that glues its words (`dayplan`) is repeated by
 * `DayPlanList`: two words.
 */
export function repeatedWords(words: readonly string[], prefix: readonly string[]): number {
    if (prefix.length === 0) {
        return 0;
    }
    if (words.length > prefix.length && prefix.every((word, index) => sameWord(words[index] ?? '', word))) {
        return prefix.length;
    }
    const glued = prefix.length === 1 ? gluedWords(words, prefix[0] ?? '') : 0;
    return glued > 1 && words.length > glued ? glued : 0;
}

/**
 * A file's name without the words `prefix` in front of its module's stem, keeping its own
 * convention and its companions: `render-json.ts` → `json.ts`, `RenderJson.cs` → `Json.cs`,
 * `render_json_test.go` → `json_test.go`, `test_render_json.py` → `test_json.py`,
 * `category-list.ts` with `categories` → `list.ts`. `undefined` when the stem does not start with
 * them (a type letter or an ignored word comes first), or nothing would be left.
 */
export function withoutPrefix(
    file: string,
    module: Pick<Module, 'stem'>,
    prefix: readonly string[],
): string | undefined {
    const name = file.normalize('NFC');
    const stem = module.stem.normalize('NFC');
    let at = name.indexOf(stem);
    if (at === -1 && name.toLowerCase().length === name.length) {
        at = name.toLowerCase().indexOf(stem.toLowerCase());
    }
    if (at === -1) {
        return undefined;
    }
    const written = name.slice(at, at + stem.length);
    const { words, spans } = readName(written);
    const repeated = repeatedWords(words, prefix);
    if (repeated === 0 || spans[0]?.[0] !== 0) {
        return undefined;
    }
    let rest = written.slice(spans[repeated - 1]?.[1] ?? 0);
    while (rest.startsWith('-') || rest.startsWith('_') || rest.startsWith(' ')) {
        rest = rest.slice(1);
    }
    return rest === '' || rest.startsWith('.')
        ? undefined
        : `${name.slice(0, at)}${rest}${name.slice(at + stem.length)}`;
}

/** Whether a move must leave the module where it is: a tool reads one of its files by name and place. */
export function staysInPlace(module: Module, folder: string, naming: Naming): boolean {
    const globs = naming.keepInPlace ?? [];
    return globs.length > 0 && module.files.some(file => matchesSelfOrAncestor(joinPath(folder, file), globs));
}

/** Moves planned for some modules, and what could not be planned as asked. */
export interface Plan {
    readonly moves: Move[];
    /** One sentence per module that kept its name, or stayed, because the place was taken. */
    readonly notes: string[];
}

/**
 * Plans the moves of `modules` from `folder` into `target`, each file named by `rename` (its own
 * name when it says nothing), never onto a path that exists or that another move takes, compared
 * without case: Windows and macOS would overwrite `Text.ts` with `text.ts`. A module whose new
 * names are taken keeps its names; when those are taken too, it stays where it is. A module moves
 * whole or not at all.
 */
export function planMoves(
    modules: readonly Module[],
    folder: string,
    target: string,
    rename: (file: string, module: Module) => string | undefined,
    existing: RuleContext<object>['existing'],
): Plan {
    const moves: Move[] = [];
    const notes: string[] = [];
    const taken = new Set<string>();
    /** Why a path cannot be taken, or `undefined` when it is free. */
    const clashAt = (path: string, from: string): string | undefined => {
        if (path === from) {
            return undefined;
        }
        if (taken.has(caseless(path))) {
            return `another module goes to ${path}`;
        }
        const there = existing?.(path);
        if (there === undefined) {
            return undefined;
        }
        return there === path ? `${there} is already there` : `${there} is already there, and differs only in case`;
    };
    for (const module of modules) {
        const renamed = module.files.map(file => rename(file, module) ?? file);
        const plans = [renamed];
        if (renamed.some((name, index) => name !== module.files[index])) {
            plans.push([...module.files]);
        }
        let chosen: readonly string[] | undefined;
        const blocked: string[] = [];
        for (const names of plans) {
            const clash = names
                .map((name, index) => clashAt(joinPath(target, name), joinPath(folder, module.files[index] ?? name)))
                .find(reason => reason !== undefined);
            if (clash === undefined) {
                chosen = names;
                break;
            }
            blocked.push(clash);
        }
        const first = joinPath(folder, module.files[0] ?? module.stem);
        if (chosen === undefined) {
            notes.push(`${first} stays where it is: ${blocked.join('; ')}.`);
            continue;
        }
        if (blocked.length > 0) {
            notes.push(`${first} keeps its name: ${blocked.join('; ')}.`);
        }
        for (const [index, file] of module.files.entries()) {
            const from = joinPath(folder, file);
            const to = joinPath(target, chosen[index] ?? file);
            taken.add(caseless(to));
            if (to !== from) {
                moves.push({ from, to });
            }
        }
    }
    return { moves, notes };
}

/** A path as Windows and macOS compare them: without case, and with one Unicode normalisation. */
export function caseless(path: string): string {
    return path.normalize('NFC').toLowerCase();
}
