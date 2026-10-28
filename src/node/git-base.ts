import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

import { normalisePath } from '../core/paths/tree.ts';
import { markedByAttributes } from './files.ts';

/**
 * The base a change is compared with (`--since`, `--changed`, `--new-since`): a commit, and the file
 * names it had. Names only — `git ls-tree` reads them from the object store, so the base needs no
 * checkout and a clone of depth 1 is enough, as long as the ref was fetched.
 */
export interface Base {
    /** The ref as the person or the CI named it, for messages: `origin/main`. */
    readonly label: string;
    /** The commit compared with: the merge base with HEAD when git can find it, else the ref itself. */
    readonly commit: string;
    /** Set when there was no merge base (a shallow clone): the ref's own tip was used. */
    readonly withoutMergeBase: boolean;
    /** The files at the base, relative to the root, as `listFiles` gives them. */
    readonly files: readonly string[];
}

/** Git's suffix that peels a ref to its commit (a tag to what it tags). */
const PEEL_TO_COMMIT = '^{commit}';

export type BaseResult = Base | { readonly problem: string };

/**
 * Where a CI says a pull request merges into, in the order they are tried. A branch is tried as
 * `origin/<branch>` first: in CI the local branch rarely exists.
 */
const CI_BASES: readonly { readonly variable: string; readonly kind: 'branch' | 'commit' }[] = [
    { variable: 'GITHUB_BASE_REF', kind: 'branch' }, // GitHub Actions, pull_request events
    { variable: 'CI_MERGE_REQUEST_DIFF_BASE_SHA', kind: 'commit' }, // GitLab merge request pipelines
    { variable: 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', kind: 'branch' }, // GitLab
    { variable: 'BITBUCKET_PR_DESTINATION_BRANCH', kind: 'branch' }, // Bitbucket Pipelines
    { variable: 'SYSTEM_PULLREQUEST_TARGETBRANCH', kind: 'branch' }, // Azure Pipelines
    { variable: 'CHANGE_TARGET', kind: 'branch' }, // Jenkins multibranch
    { variable: 'BUILDKITE_PULL_REQUEST_BASE_BRANCH', kind: 'branch' }, // Buildkite
];

export interface CiBase {
    readonly variable: string;
    readonly value: string;
    /** The refs to try, in order. */
    readonly refs: readonly string[];
}

/** The base of the pull request the CI is building, from its environment; none outside one. */
export function ciBaseOf(env: Readonly<Record<string, string | undefined>>): CiBase[] {
    const found: CiBase[] = [];
    for (const { variable, kind } of CI_BASES) {
        const value = env[variable]?.trim();
        if (value === undefined || ['', 'false'].includes(value)) {
            continue;
        }
        const branch = value.replace(/^refs\/heads\//u, '');
        found.push({ variable, value, refs: kind === 'commit' ? [value] : [`origin/${branch}`, branch] });
    }
    return found;
}

/** Resolves `ref` in the repository that holds `root` and lists the files it had under `root`. */
export function readBase(root: string, ref: string, label = ref): BaseResult {
    if (ref.startsWith('-')) {
        // Passed to git as an argument: a ref that starts with a dash would be read as an option.
        return { problem: `"${ref}" is not a ref` };
    }
    if (git(root, ['rev-parse', '--git-dir']) === undefined) {
        return { problem: `${root} is not in a git repository (or git cannot be run there)` };
    }
    const tip = git(root, ['rev-parse', '--verify', '--quiet', `${ref}${PEEL_TO_COMMIT}`])?.trim();
    if (tip === undefined || tip === '') {
        return {
            problem: `git does not know "${ref}". Fetch it first: git fetch --depth=1 origin <branch>:refs/remotes/origin/<branch> (or check out with fetch-depth: 0)`,
        };
    }
    const mergeBase = git(root, ['merge-base', tip, 'HEAD'])?.trim();
    const commit = mergeBase === undefined || mergeBase === '' ? tip : mergeBase;
    const files = filesAt(root, commit);
    if (files === undefined) {
        return { problem: `git could not list the files of "${ref}"` };
    }
    return {
        label,
        commit,
        withoutMergeBase: mergeBase === undefined || mergeBase === '',
        files,
    };
}

/**
 * The files a commit had under `root`, as `listFiles` gives them: blobs only (a submodule is another
 * repository), without what its `.gitattributes` marks generated or vendored. `undefined` when git
 * cannot list it.
 */
export function filesAt(root: string, commit: string): string[] | undefined {
    const listing = git(root, ['ls-tree', '-r', '-z', commit]);
    if (listing === undefined) {
        return undefined;
    }
    const files: string[] = [];
    for (const record of listing.split('\0')) {
        // `<mode> <type> <object>\t<path>`; a submodule is a `commit`, another repository's folder.
        const tab = record.indexOf('\t');
        if (tab === -1 || !record.slice(0, tab).includes(' blob ')) {
            continue;
        }
        const path = normalisePath(record.slice(tab + 1));
        if (path !== undefined) {
            files.push(path);
        }
    }
    // The commit's own list is complete: without a .gitattributes in it, nothing is marked, and git need not be asked.
    const hasAttributes = files.some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'));
    const marked = (hasAttributes ? markedByAttributes(root, files) : undefined) ?? new Set<string>();
    return marked.size === 0 ? files : files.filter(path => !marked.has(path));
}

/** One commit of the first-parent history: its hash and its committer date (ISO 8601). */
export interface LoggedCommit {
    readonly commit: string;
    readonly date: string;
}

/**
 * The commits of `ref` along its first parents, newest first: the history of the branch itself, one
 * commit per merge, not every commit of every merged branch. `undefined` when git cannot read it.
 */
export function firstParentLog(root: string, ref = 'HEAD'): LoggedCommit[] | undefined {
    if (ref.startsWith('-')) {
        return undefined;
    }
    const log = git(root, ['log', '--first-parent', '--format=%H %cI', ref, '--']);
    if (log === undefined) {
        return undefined;
    }
    return log
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
        .map(line => {
            const space = line.indexOf(' ');
            return { commit: line.slice(0, space), date: line.slice(space + 1) };
        });
}

function git(root: string, args: readonly string[]): string | undefined {
    try {
        return execFileSync('git', ['-C', root, ...args], {
            encoding: 'utf8',
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
}

/**
 * The text of a file as it was at `ref` (`git show <ref>:./<name>`, from the file's folder), or why it
 * cannot be read: the ref is unknown, or the file did not exist there.
 */
export function textAt(path: string, ref: string): { readonly text: string } | { readonly problem: string } {
    if (ref.startsWith('-')) {
        return { problem: `"${ref}" is not a ref` };
    }
    const dir = dirname(path);
    const tip = git(dir, ['rev-parse', '--verify', '--quiet', `${ref}${PEEL_TO_COMMIT}`])?.trim();
    if (tip === undefined || tip === '') {
        return {
            problem: `git does not know "${ref}". Fetch it first: git fetch --depth=1 origin <branch>:refs/remotes/origin/<branch>`,
        };
    }
    const text = git(dir, ['show', `${tip}:./${basename(path)}`]);
    return text === undefined ? { problem: `${basename(path)} did not exist on ${ref}` } : { text };
}
