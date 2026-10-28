import type { Glob } from '../paths/glob.ts';
import { sameWord } from './inflect.ts';
import { isDigit, isNumericWord, readName, splitWords } from './words.ts';

/** How file names are read: which files are one module, and which leading words are not a subject. */
export interface Naming {
    /**
     * Applied in order to each stem; what they match is removed. They are what makes `foo_test.go`,
     * `test_foo.py` and `FooTest.java` the same module as `foo.go`, `foo.py` and `Foo.java`.
     */
    readonly companions: readonly RegExp[];
    /** Lowercase words dropped from the front before reading the subject: `i` of `IUserService`, `bp` of `BP_Door`. */
    readonly ignoreLeadingWords: ReadonlySet<string>;
    /**
     * When false, a module whose subject starts with a number (`0001_initial`, `2024-01-01-post`) belongs to no group.
     */
    readonly groupNumericPrefixes: boolean;
    /**
     * File names that describe their folder instead of being one more thing in it, and are not
     * counted: `package-info.java`, `__init__.py`, `doc.go`, `mod.rs`.
     */
    readonly folderFiles?: readonly Glob[];
    /**
     * Endings that, after the name of a sibling folder, make a file that goes with that folder and is
     * not counted: Unity's `Scripts.meta`, next to `Scripts/`.
     */
    readonly folderCompanions?: readonly string[];
}

/** A module: the files of one folder that share a stem — `foo.ts`, `foo.spec.ts`, `foo.html`. */
export interface Module {
    /** The stem every file of the module shares, after removing companions: `user-service`. */
    readonly stem: string;
    /** File names, sorted. */
    readonly files: readonly string[];
    /** Every word of the stem, lowercase: `['i', 'user', 'service']`. */
    readonly words: readonly string[];
    /**
     * The words that say what the module is about, after a type letter and the ignored leading words:
     * `['user', 'service']`. Empty for a dotted package name (`org.example.Service`), which a tool
     * wrote and which belongs to no group.
     */
    readonly subject: readonly string[];
}

/** A file of a folder that is not counted, and why. */
export interface Uncounted {
    readonly file: string;
    readonly reason: string;
}

/** The files of one folder, read: their modules, and the files that are not counted. */
export interface FolderNames {
    readonly modules: Module[];
    readonly uncounted: Uncounted[];
}

/**
 * The stem of a file name: everything before the first dot, without companions and without the
 * underscores that mark partials and dunder files (`_tokens.scss`, `__init__.py`).
 *
 * The first dot, not the last, is what joins `foo.spec.ts`, `foo.component.html`, `Player.cs.meta`
 * and `foo.d.ts` with `foo.ts`. Except:
 *
 * - a dot before a number is part of the name: `v1.25.1.md` is `v1.25.1`, `db.changelog-1.3.xml` is
 *   `db.changelog-1.3`, `ls.1` is `ls.1`;
 * - dots inside brackets are part of the name: `[...slug].tsx` is `[...slug]` (Expo Router, Next.js);
 * - a reverse package name is taken whole: `org.example.Service`, `Elixir.MyApp.User.beam`.
 *
 * A name that is only a dot-file (`.gitignore`) keeps its name.
 */
export function stemOf(fileName: string, naming: Pick<Naming, 'companions'>): string {
    const name = fileName.normalize('NFC');
    const withoutLeadingDots = trimStart(name, '.');
    if (isPackageName(withoutLeadingDots)) {
        return packageStem(withoutLeadingDots);
    }
    let stem = withoutLeadingDots.slice(0, stemEnd(withoutLeadingDots));
    if (stem === '') {
        stem = withoutLeadingDots === '' ? name : withoutLeadingDots;
    }
    // Until nothing changes, so suffixes stack: `x_linux_amd64_test` → `x_linux_amd64` → `x_linux` → `x`.
    // Bounded, in case two patterns feed each other.
    for (let pass = 0; pass < 8; pass++) {
        const before = stem;
        for (const companion of naming.companions) {
            const stripped = stem.replace(companion, '');
            // A companion never erases a name: `test.py` stays `test`, not ''.
            if (stripped !== '') {
                stem = stripped;
            }
        }
        if (stem === before) {
            break;
        }
    }
    const trimmed = trimEnd(trimStart(stem, '_'), '_');
    return trimmed === '' ? stem : trimmed;
}

/** Where the stem of a name (without leading dots) ends. */
function stemEnd(text: string): number {
    // After the last version in the name (`1.3` of `db.changelog-1.3.xml`), so that its dots stay.
    let versionEnd = 0;
    for (let index = 1; index < text.length - 1; index++) {
        if (text[index] !== '.' || !isDigit(text[index - 1] ?? '') || !isDigit(text[index + 1] ?? '')) {
            continue;
        }
        let end = index + 1;
        while (isDigit(text[end] ?? '')) {
            end++;
        }
        versionEnd = end;
        index = end - 1;
    }
    let depth = 0;
    let unbracketed = -1;
    for (let index = versionEnd; index < text.length; index++) {
        const char = text[index];
        if (char === '[') {
            depth++;
        } else if (char === ']') {
            depth = Math.max(0, depth - 1);
        } else if (char === '.' && !startsNumber(text, index + 1)) {
            if (depth === 0) {
                return index;
            }
            if (unbracketed === -1) {
                unbracketed = index;
            }
        }
    }
    // A bracket that never closes is not a route segment: the first dot then.
    return unbracketed === -1 ? text.length : unbracketed;
}

/**
 * Whether digits start at `index` and end the name, or are followed by a dot or a separator: `.2`
 * in `config.2.json` and `.1` in `ls.1` are part of the name; `.7z` and `.3gp` are extensions.
 */
function startsNumber(text: string, index: number): boolean {
    let end = index;
    while (isDigit(text[end] ?? '')) {
        end++;
    }
    if (end === index) {
        return false;
    }
    const after = text[end];
    return after === undefined || ['.', '-', '_'].includes(after);
}

/** The first segment of a reverse package name: `org.example.Service`, `Elixir.MyApp.User`. */
const PACKAGE_ROOTS: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gov', 'Elixir']);
const IDENTIFIER = /^[\p{L}\p{N}_$-]+$/u;
const EXTENSION = /^[a-z\d]{1,5}$/u;

/**
 * Whether a name is a reverse package name, three or more dotted identifiers from a domain:
 * `META-INF/services/org.example.Service` (Java's ServiceLoader), `Elixir.MyApp.User.beam`. Each is
 * a different thing; cut at the first dot, they would all be `org`.
 */
function isPackageName(text: string): boolean {
    const segments = text.split('.');
    return (
        segments.length >= 3 &&
        PACKAGE_ROOTS.has(segments[0] ?? '') &&
        segments.every(segment => IDENTIFIER.test(segment))
    );
}

/** A package name without its extension, when the last segment looks like one: `Elixir.X.M1.beam` → `Elixir.X.M1`. */
function packageStem(text: string): string {
    const segments = text.split('.');
    return segments.length >= 4 && EXTENSION.test(segments.at(-1) ?? '') ? segments.slice(0, -1).join('.') : text;
}

/**
 * The words of a stem that say what it is about: a type letter (`I` of `IUserService`) and the
 * leading ignored words dropped, at least one kept.
 */
export function subjectOf(
    words: readonly string[],
    naming: Pick<Naming, 'ignoreLeadingWords'>,
    typePrefix = false,
): readonly string[] {
    let start = typePrefix && words.length > 1 ? 1 : 0;
    while (start < words.length - 1 && naming.ignoreLeadingWords.has(words[start] ?? '')) {
        start++;
    }
    return words.slice(start);
}

/**
 * The group a module belongs to, from the first `length` words of its subject, or `undefined` when
 * it belongs to none: a subject shorter than that, or one that starts with a number when numbers do
 * not group. Singular and plural are not joined here, only within a folder: see `groupModules`.
 */
export function groupKeyOf(
    module: Module,
    length: number,
    naming: Pick<Naming, 'groupNumericPrefixes'>,
): string | undefined {
    if (module.subject.length < length) {
        return undefined;
    }
    const first = module.subject[0] ?? '';
    return !naming.groupNumericPrefixes && isNumericWord(first) ? undefined : module.subject.slice(0, length).join('-');
}

/** Groups the files of one folder into modules, sorted by stem. */
export function modulesOf(fileNames: readonly string[], naming: Naming, folders: readonly string[] = []): Module[] {
    return readFolder(fileNames, naming, folders).modules;
}

/**
 * Reads the files of one folder: the ones that are not counted (`naming.folderFiles`,
 * `naming.folderCompanions` next to the sibling `folders`), and the rest as modules, sorted by stem.
 */
export function readFolder(fileNames: readonly string[], naming: Naming, folders: readonly string[] = []): FolderNames {
    const siblings = new Set(folders);
    const uncounted: Uncounted[] = [];
    // Lowercase stem → stem as written → files.
    const byId = new Map<string, Map<string, string[]>>();
    for (const name of fileNames) {
        const reason = uncountedReason(name, naming, siblings);
        if (reason !== undefined) {
            uncounted.push({ file: name, reason });
            continue;
        }
        const stem = stemOf(name, naming);
        const id = stem.toLowerCase();
        let spellings = byId.get(id);
        if (!spellings) {
            spellings = new Map();
            byId.set(id, spellings);
        }
        const files = spellings.get(stem);
        if (files) {
            files.push(name);
        } else {
            spellings.set(stem, [name]);
        }
    }
    const modules: Module[] = [];
    for (const spellings of byId.values()) {
        for (const { stem, files } of joinSpellings(spellings)) {
            const read = readName(stem);
            const subject = isPackageName(stem) ? [] : subjectOf(read.words, naming, read.typePrefix);
            modules.push({ stem, files: files.toSorted(compareText), words: read.words, subject });
        }
    }
    return { modules: modules.toSorted((a, b) => compareText(a.stem, b.stem)), uncounted };
}

/**
 * Joins the spellings of one stem that differ only in case: `README.md` and `Readme.txt` are one
 * module, as they are on a disk that ignores case. Not two files whose whole names differ only in
 * case (`Foo.ts` and `foo.ts`): Linux keeps both, so they are two things, and `case-collision` says
 * that they cannot be checked out on Windows or macOS. The stem is the spelling most files use.
 */
function joinSpellings(spellings: ReadonlyMap<string, readonly string[]>): { stem: string; files: string[] }[] {
    const ordered = [...spellings].toSorted(
        ([stemA, filesA], [stemB, filesB]) => filesB.length - filesA.length || compareText(stemA, stemB),
    );
    const joined: { stem: string; files: string[]; names: Set<string> }[] = [];
    for (const [stem, files] of ordered) {
        const lower = files.map(file => file.toLowerCase());
        const into = joined.find(module => lower.every(name => !module.names.has(name)));
        if (into) {
            into.files.push(...files);
            for (const name of lower) {
                into.names.add(name);
            }
        } else {
            joined.push({ stem, files: [...files], names: new Set(lower) });
        }
    }
    return joined;
}

function uncountedReason(name: string, naming: Naming, siblings: ReadonlySet<string>): string | undefined {
    const glob = naming.folderFiles?.find(candidate => candidate.test(name));
    if (glob) {
        return `describes its folder (naming.folderFiles "${glob.source}")`;
    }
    for (const ending of naming.folderCompanions ?? []) {
        if (name.length > ending.length && name.endsWith(ending) && siblings.has(name.slice(0, -ending.length))) {
            return `goes with the folder ${name.slice(0, -ending.length)}/ (naming.folderCompanions "${ending}")`;
        }
    }
    return undefined;
}

/**
 * The name to show for a module: its stem when a file is called that, else its first file —
 * `IUserRepository.cs`, not a `UserRepository` that does not exist.
 */
export function shownName(module: Module): string {
    const { stem } = module;
    const isLiteral = module.files.some(file => {
        const name = file.normalize('NFC');
        return name.startsWith(stem) && (name.length === stem.length || name[stem.length] === '.');
    });
    return isLiteral ? stem : (module.files[0] ?? stem);
}

/**
 * Modules that read as the same subject but are two modules, because something in front of the
 * subject differs: `IProfile` and `MProfile`. `explain` says which companion would join them.
 */
export interface SameTopic {
    readonly subject: string;
    readonly modules: readonly Module[];
    /** A companion pattern that would make them one module. */
    readonly companion: string;
}

export function sameTopics(modules: readonly Module[]): SameTopic[] {
    const bySubject = new Map<string, Module[]>();
    for (const module of modules) {
        if (module.subject.length === 0) {
            continue;
        }
        const key = module.subject.join('-');
        const group = bySubject.get(key);
        if (group) {
            group.push(module);
        } else {
            bySubject.set(key, [module]);
        }
    }
    const found: SameTopic[] = [];
    for (const [subject, group] of bySubject) {
        if (group.length < 2) {
            continue;
        }
        const leads = group.map(module => leadOf(module));
        const written = [...new Set(leads.filter(lead => lead !== ''))];
        if (written.length === 0) {
            continue;
        }
        const glued = group.every((module, index) => {
            const next = module.stem.normalize('NFC')[(leads[index] ?? '').length] ?? '';
            return next.toUpperCase() === next && next.toLowerCase() !== next;
        });
        const alternatives = written.map(lead => escapeRegExp(lead)).join('|');
        const pattern = written.length === 1 ? alternatives : `(?:${alternatives})`;
        found.push({ subject, modules: group, companion: `^${pattern}${glued ? '(?=\\p{Lu})' : ''}` });
    }
    return found;
}

/** What comes before the subject in a stem, as written: `I` of `IProfile`, `use-` of `use-profile`. */
function leadOf(module: Module): string {
    const stem = module.stem.normalize('NFC');
    const { spans } = readName(stem);
    const first = spans[module.words.length - module.subject.length];
    return first === undefined ? '' : stem.slice(0, first[0]);
}

function escapeRegExp(text: string): string {
    return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

/** The words of a folder name, joined the way group keys are: `RenderTargets` → `render-targets`. */
export function folderKeyOf(folderName: string): string {
    return splitWords(folderName).join('-');
}

/**
 * Whether a group key only restates where the files already are: the name of their folder or of a
 * folder above it, allowing the plural. `render-*` in `render/`, `hook-*` in `hooks/`, `category-*`
 * in `categories/`, `drag-*` in `drag-drop/`, `Color*` in `ColorPicker/`, `toolbar-*` in
 * `toolbar/testing/`: moving them into a folder named after the key would say the same word twice.
 *
 * A folder may also glue the words together in lowercase, as Java and Kotlin packages do:
 * `feature/dayplan/` holds `DayPlanList`, `DayPlanRow`…, so the key `day` restates it. That is read
 * from the `modules` of the group: a folder name spelled by their leading words, glued.
 */
export function keyRestatesPath(key: string, folderPath: string, modules: readonly Module[] = []): boolean {
    if (folderPath === '.') {
        return false;
    }
    const keyWords = key.split('-');
    return folderPath.split('/').some(segment => {
        const words = splitWords(segment);
        if (containsWords(words, keyWords)) {
            return true;
        }
        const glued = words.join('');
        return modules.some(module => gluedWords(module.subject, glued) >= keyWords.length);
    });
}

/**
 * How many leading words, glued together, spell `glued` (the plural allowed): 2 for `day`, `plan`,
 * `list` and `dayplan` or `dayplans`; 0 when they do not.
 */
export function gluedWords(words: readonly string[], glued: string): number {
    let joined = '';
    for (const [index, word] of words.entries()) {
        joined += word;
        if (sameWord(joined, glued)) {
            return index + 1;
        }
        if (!glued.startsWith(joined)) {
            return 0;
        }
    }
    return 0;
}

function containsWords(words: readonly string[], sequence: readonly string[]): boolean {
    for (let start = 0; start + sequence.length <= words.length; start++) {
        if (sequence.every((word, offset) => sameWord(words[start + offset] ?? '', word))) {
            return true;
        }
    }
    return false;
}

/** Locale-independent order, so that output is the same on every machine. */
export function compareText(a: string, b: string): number {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function trimStart(text: string, char: string): string {
    let start = 0;
    while (text[start] === char) {
        start++;
    }
    return text.slice(start);
}

function trimEnd(text: string, char: string): string {
    let end = text.length;
    while (end > 0 && text[end - 1] === char) {
        end--;
    }
    return text.slice(0, end);
}
