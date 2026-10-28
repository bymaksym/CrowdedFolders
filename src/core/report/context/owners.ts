import { compileGlob, type Glob, matchesSelfOrAncestor } from '../../paths/glob.ts';

/** One line of a CODEOWNERS file: a pattern and who owns what it matches (nobody, for a pattern alone). */
interface OwnerRule {
    readonly globs: readonly Glob[];
    /** Whether the pattern also owns what is below a folder it matches. */
    readonly includesBelow: boolean;
    readonly directoryOnly: boolean;
    readonly owners: readonly string[];
}

export type Codeowners = readonly OwnerRule[];

/**
 * Reads a CODEOWNERS file (GitHub and GitLab). The last pattern that matches wins; `#` starts a
 * comment; a pattern with no owners makes what it matches unowned. GitLab sections (`[Docs]`) are
 * skipped: their patterns are read as the lines they are.
 */
export function parseCodeowners(text: string): Codeowners {
    const rules: OwnerRule[] = [];
    for (const raw of text.split(/\r?\n/u)) {
        const line = raw.replace(/(?:^|\s)#.*$/u, '').trim();
        if (line === '' || line.startsWith('[') || line.startsWith('^[')) {
            continue;
        }
        const [pattern = '', ...owners] = line.split(/\s+/u);
        rules.push(ruleOf(pattern, owners));
    }
    return rules;
}

/** The owners of a path (a file, or a folder written as `folder/`), as written in the file; empty when unowned. */
export function ownersOf(codeowners: Codeowners, path: string): readonly string[] {
    for (let index = codeowners.length - 1; index >= 0; index--) {
        const rule = codeowners[index];
        if (rule && matches(rule, path)) {
            return rule.owners;
        }
    }
    return [];
}

function ruleOf(pattern: string, owners: readonly string[]): OwnerRule {
    const directoryOnly = pattern.endsWith('/');
    const body = pattern.replace(/^\/+/u, '').replace(/\/+$/u, '');
    // `docs/*` owns the files of docs but not docs/guides/a.md; `docs` and `docs/` own everything below.
    const lastSegment = body.slice(body.lastIndexOf('/') + 1);
    const includesBelow = directoryOnly || (!/[*?[]/u.test(lastSegment) && lastSegment !== '');
    const rooted = pattern.startsWith('/') || body.includes('/');
    const glob = rooted ? `/${body}` : body;
    return { globs: [compileGlob(glob)], includesBelow, directoryOnly, owners };
}

function matches(rule: OwnerRule, path: string): boolean {
    const isDirectory = path.endsWith('/');
    const file = isDirectory ? path.slice(0, -1) : path;
    if (rule.directoryOnly) {
        // Only what is inside a folder with that name: the path's own folders, not the path itself unless it is one.
        return matchesSelfOrAncestor(isDirectory ? file : parent(file), rule.globs);
    }
    return rule.includesBelow ? matchesSelfOrAncestor(file, rule.globs) : rule.globs.some(glob => glob.test(file));
}

function parent(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
}
