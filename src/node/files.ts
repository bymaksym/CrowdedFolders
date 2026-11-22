import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { type IgnoreFile, isIgnored, parseGitignore } from '../core/paths/gitignore.ts';
import { isAbsolutePath, normaliseFileList, type PathProblem } from '../core/paths/input.ts';
import { normalisePath } from '../core/paths/tree.ts';
import { gitRootOf } from './config/file.ts';
import { realPathOfAny } from './config/real-path.ts';

export interface FileList {
    readonly files: readonly string[];
    /** Where the list came from, for messages. */
    readonly source: 'filesystem' | 'git' | 'stdin';
    /** When the list was not made the usual way, what to tell the person reading the report. */
    readonly notice?: string;
}

export interface ListOptions {
    /** Ask git (the default way); false reads the disk, as `--no-git` asks. */
    readonly git: boolean;
    /** Stop instead of reading the disk when git cannot be asked: `--require-git`, and the default on CI. */
    readonly requireGit?: boolean;
    /** What made the run CI when `requireGit` comes from it, not from `--require-git`: `TF_BUILD=True`. */
    readonly requiredBy?: string;
    /**
     * Only what git tracks, not the untracked files `.gitignore` does not hide: a file a previous CI
     * step left in the checkout is not part of the repository. `--tracked-only`, and the default on CI.
     */
    readonly trackedOnly?: boolean;
    /** The environment git runs with; `GIT_DIR` in it means a repository even without a `.git` here. */
    readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Git was needed and could not answer. Never read the disk instead without saying so: it lists what .gitignore hides. */
export class GitError extends Error {
    override readonly name = 'GitError';
}

/** Folders never walked when there is no git to ask: they are always someone else's or generated. */
const ALWAYS_SKIPPED = new Set(['.git', '.hg', '.svn', 'node_modules']);

/**
 * The attributes that say a file is generated or vendored, as pathspecs that leave such files out:
 * a repository that tells GitHub to fold them in diffs has already said nobody arranges them by hand.
 * Both forms, because `linguist-generated` and `linguist-generated=true` are different values to git.
 */
const MARKED = ['linguist-generated', 'linguist-generated=true', 'linguist-vendored', 'linguist-vendored=true'];

const WITHOUT_GIT = 'with its .gitignore files read by crowded-folders; .gitattributes is not read';

/**
 * The files of the repository, relative to `root`: what git tracks plus what it would add (the
 * untracked files `.gitignore` does not hide), minus what was deleted and what `.gitattributes`
 * marks as generated or vendored. Without git (`git: false`), or outside a repository, every file
 * under `root` that the `.gitignore` files do not hide.
 *
 * Inside a repository, a git that fails is an error: reading the disk instead would count what
 * `.gitignore` hides (build/, reports/) and look like an ordinary run.
 */
export function listFiles(root: string, options: ListOptions): FileList {
    if (!options.git) {
        return { files: walk(root), source: 'filesystem' };
    }
    const env = { ...process.env, ...options.env };
    const isRepository = gitRootOf(root) !== undefined || (env['GIT_DIR'] ?? '') !== '';
    if (!isRepository) {
        if (options.requireGit) {
            throw new GitError(
                `${root} is not in a git repository, and git's list was required (${options.requiredBy === undefined ? '--require-git' : `the default in CI, ${options.requiredBy}`}): pass --no-git to read the files from the disk.`,
            );
        }
        return {
            files: walk(root),
            source: 'filesystem',
            notice: `${root} is not in a git repository: the files were read from the disk, ${WITHOUT_GIT}.`,
        };
    }
    return { files: gitFiles(root, env, options.trackedOnly === true), source: 'git' };
}

/** Reads paths, one per line (`\n`, `\r\n` or a lone `\r`) or NUL-separated, as given: not yet normalised. */
export function parseFileList(text: string): string[] {
    const separator = text.includes('\0') ? '\0' : /\r\n|\r|\n/u;
    return text
        .split(separator)
        .map(line => line.trim())
        .filter(line => line !== '');
}

/**
 * A file list from outside (standard input, `lint({ files })`, `where`) as files of `root`, which is a
 * real path: an absolute path is read as its real path first, so `C:\link\src\a.ts` through a
 * junction, a short name or macOS's `/var` is the file under the root it is, not a path outside it.
 */
export function readFileList(
    paths: Iterable<string>,
    root: string,
): { readonly files: string[]; readonly problems: PathProblem[] } {
    return normaliseFileList(
        [...paths].map(path => (isAbsolutePath(path) ? realPathOfAny(path) : path)),
        root,
    );
}

/** Runs git in a folder with some input, and gives its output, or `undefined` when it fails. */
export type GitRunner = (root: string, args: readonly string[], input?: string) => string | undefined;

const runGitWith: GitRunner = (root, args, input) => {
    try {
        return execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            ...(input !== undefined && { input }),
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
    } catch {
        return;
    }
};

/** Whether the text of an attributes file can mark a file generated or vendored. */
const canMark = (text: string): boolean => text.includes('linguist-generated') || text.includes('linguist-vendored');

function readText(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * The files of a list that an attributes file could mark, so that git is asked about them and no other:
 * all of them when an attributes file outside the tree can (`info/attributes`, the global or the system
 * one, or a .gitattributes above the root), otherwise those under a folder whose `.gitattributes` can.
 * `undefined` when git cannot say where those files are.
 *
 * `git check-attr` looks for a `.gitattributes` in every folder of every path it is given: for the 12 000
 * paths of spring-boot, in a repository whose attributes mark nothing, that took seconds on Windows
 * (point 166). Finding the files that could mark costs three short git calls, whatever the size of the list.
 */
function filesAttributesCanMark(root: string, files: readonly string[], git: GitRunner): readonly string[] | undefined {
    const revParse = git(root, ['rev-parse', '--show-prefix', '--git-path', 'info/attributes']);
    const variables = git(root, ['var', '-l']);
    // Tracked and untracked (not ignored) .gitattributes: what git reads. One call, not a look in every folder.
    const indexed = git(root, [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        ':(glob)**/.gitattributes',
    ]);
    if (revParse === undefined || variables === undefined || indexed === undefined) {
        return undefined;
    }
    const [prefix = '', infoPath = ''] = revParse.split('\n').map(line => line.trim());
    // When the root is a folder of the repository, the .gitattributes of the folders above it count too.
    const above = prefix
        .split('/')
        .filter(part => part !== '')
        .map((_, index, parts) => join(root, ...parts.slice(index).map(() => '..'), '.gitattributes'));
    const outside = [infoPath, ...above];
    // Git 2.42 and later name the global and system files (without the system one under GIT_ATTR_NOSYSTEM).
    // An older git names neither: ask it about every file, as before.
    const named = variables
        .split('\n')
        .filter(entry => entry.startsWith('GIT_ATTR_GLOBAL=') || entry.startsWith('GIT_ATTR_SYSTEM='));
    if (named.length === 0) {
        return files;
    }
    outside.push(...named.map(entry => entry.slice(entry.indexOf('=') + 1).trim()));
    if (outside.some(path => path !== '' && canMark(readText(resolve(root, path)) ?? ''))) {
        return files;
    }
    // The folders whose .gitattributes can mark. One only in the index (git reads it from there when the
    // working tree has none) is not read here, so it counts as one that can.
    const marking = new Set<string>();
    for (const path of indexed.split('\0')) {
        if (path !== '.gitattributes' && !path.endsWith('/.gitattributes')) continue;
        const text = readText(join(root, path));
        if (text === undefined || canMark(text)) {
            marking.add(path.slice(0, Math.max(0, path.length - '/.gitattributes'.length)));
        }
    }
    if (marking.size === 0) {
        return [];
    }
    return files.filter(file => {
        if (marking.has('')) return true;
        for (let slash = file.indexOf('/'); slash !== -1; slash = file.indexOf('/', slash + 1)) {
            if (marking.has(file.slice(0, slash))) return true;
        }
        return false;
    });
}

/**
 * The files of a list (relative to `root`) that `.gitattributes` marks as generated or vendored,
 * asked to git as it reads them, nested files included; `undefined` when git cannot say. For `--stdin`,
 * whose list git did not make, and for the list of a commit. Git is asked only about the files an
 * attributes file could mark: a list no attributes file mentions costs three short git calls.
 */
export function markedByAttributes(
    root: string,
    files: readonly string[],
    git: GitRunner = runGitWith,
): Set<string> | undefined {
    const asked = filesAttributesCanMark(root, files, git);
    if (asked === undefined) {
        return undefined;
    }
    if (asked.length === 0) {
        return new Set();
    }
    const output = git(
        root,
        ['check-attr', '-z', '--stdin', 'linguist-generated', 'linguist-vendored'],
        `${asked.join('\0')}\0`,
    );
    if (output === undefined) {
        return undefined;
    }
    // Records of three fields: the path, the attribute, and its value ("set", "unset", "unspecified" or
    // the value written, such as "true").
    const marked = new Set<string>();
    const fields = output.split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
        const value = fields[index + 2];
        if (value === 'set' || value === 'true') {
            marked.add(fields[index] ?? '');
        }
    }
    return marked;
}

/** Whether git tracks this file; false when it does not, or when there is no git to ask. */
export function isTrackedByGit(path: string): boolean {
    try {
        execFileSync('git', ['-C', dirname(path), 'ls-files', '--error-unmatch', '--', basename(path)], {
            stdio: 'ignore',
        });
        return true;
    } catch {
        return false;
    }
}

/** Whether `.gitignore` hides this path (a file that does not exist yet too); false when it does not, or there is no git. */
export function isIgnoredByGit(root: string, path: string): boolean {
    try {
        execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', path], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * One `git ls-files` for everything: `-t` tags each record (`?` untracked, `R` deleted), `--stage`
 * gives the mode, which tells a submodule (160000, another repository) from a file, and the attribute
 * pathspecs leave out what is marked generated. One process instead of four: on Windows each costs
 * about a tenth of a second.
 */
function gitFiles(root: string, env: Readonly<Record<string, string | undefined>>, trackedOnly: boolean): string[] {
    const pathspecs = ['.', ...MARKED.map(attribute => `:(exclude,attr:${attribute})`)];
    const args = [
        'ls-files',
        '-z',
        '-t',
        '--stage',
        '--cached',
        ...(trackedOnly ? [] : ['--others']),
        '--deleted',
        '--exclude-standard',
    ];
    const output = runGit(root, [...args, '--', ...pathspecs], env);

    const files = new Set<string>();
    const deleted = new Set<string>();
    for (const record of output.split('\0')) {
        const tag = record[0];
        const rest = record.slice(2);
        if (tag === '?') {
            // An untracked folder git does not enter (a nested repository) comes as `nested/`: not a file.
            if (!rest.endsWith('/') && rest !== '') {
                files.add(rest);
            }
            continue;
        }
        const tab = rest.indexOf('\t');
        if (tab === -1 || rest.startsWith('160000 ')) {
            continue;
        }
        (tag === 'R' ? deleted : files).add(rest.slice(tab + 1));
    }
    return [...files].filter(path => !deleted.has(path)).flatMap(path => normalisePath(path) ?? []);
}

function runGit(root: string, args: readonly string[], env: Readonly<Record<string, string | undefined>>): string {
    try {
        return execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            env,
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
        const advice = `Fix that, or pass --no-git to read the files from the disk (${WITHOUT_GIT}).`;
        if (failure.code === 'ENOENT') {
            throw new GitError(
                `${root} is in a git repository, but git is not installed or not on the PATH. ${advice}`,
                { cause: error },
            );
        }
        const said = String(failure.stderr ?? '').trim() || failure.message;
        throw new GitError(`git could not list the files of ${root}:\n  ${said.replaceAll('\n', '\n  ')}\n${advice}`, {
            cause: error,
        });
    }
}

/**
 * Every file under `root`, without what its `.gitignore` files hide (and the ones above it, up to
 * the top of its repository). A loop with a list of folders still to read, not recursion, so that a
 * very deep tree cannot overflow the stack. Sorted, so that the order does not depend on the disk.
 */
function walk(root: string): string[] {
    const ignoreCase = process.platform === 'win32' || process.platform === 'darwin';
    const files: string[] = [];
    const pending: { readonly folder: string; readonly ignores: readonly IgnoreFile[] }[] = [
        { folder: '', ignores: ignoresAbove(root, ignoreCase) },
    ];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const { folder } = next;
        let entries;
        try {
            entries = readdirSync(join(root, folder), { withFileTypes: true });
        } catch {
            continue;
        }
        let ignores = next.ignores;
        if (entries.some(entry => entry.name === '.gitignore' && entry.isFile())) {
            const rules = readIgnoreFile(join(root, folder, '.gitignore'));
            ignores = [...ignores, { folder, above: '', rules, ignoreCase }];
        }
        for (const entry of entries) {
            const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!ALWAYS_SKIPPED.has(entry.name) && !isIgnored(ignores, path, true)) {
                    pending.push({ folder: path, ignores });
                }
            } else if (entry.isFile() && !isIgnored(ignores, path, false)) {
                files.push(path);
            }
        }
    }
    return files.toSorted((a, b) => a.localeCompare(b));
}

/** The ignore files that apply to `root` from above it: the repository's info/exclude and each `.gitignore` on the way down. */
function ignoresAbove(root: string, ignoreCase: boolean): IgnoreFile[] {
    const top = gitRootOf(root);
    if (top === undefined) {
        return [];
    }
    const folders: string[] = [];
    for (let dir = root; dir !== top && dirname(dir) !== dir;) {
        dir = dirname(dir);
        folders.unshift(dir);
    }
    const ignores: IgnoreFile[] = [];
    const exclude = join(top, '.git', 'info', 'exclude');
    if (existsSync(exclude) && statSync(exclude).isFile()) {
        ignores.push(fromAbove(top, root, readIgnoreFile(exclude), ignoreCase));
    }
    for (const dir of folders) {
        const file = join(dir, '.gitignore');
        if (existsSync(file)) {
            ignores.push(fromAbove(dir, root, readIgnoreFile(file), ignoreCase));
        }
    }
    return ignores;
}

function fromAbove(dir: string, root: string, rules: IgnoreFile['rules'], ignoreCase: boolean): IgnoreFile {
    const above = relative(dir, root).replaceAll('\\', '/');
    return { folder: '', above, rules, ignoreCase };
}

function readIgnoreFile(path: string): IgnoreFile['rules'] {
    try {
        return parseGitignore(readFileSync(path, 'utf8'));
    } catch {
        return [];
    }
}
