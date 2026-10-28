import { execFileSync } from 'node:child_process';

/**
 * The files a change adds relative to a base (`origin/main`), as paths relative to `root`; `undefined`
 * when git cannot say (no git, a shallow clone without the base, a ref that does not exist). It is
 * only used to put annotations where the pull request shows, so failing is not an error.
 */
export function addedFiles(root: string, base: string): Set<string> | undefined {
    for (const range of [`${base}...HEAD`, `${base}..HEAD`]) {
        try {
            const output = execFileSync(
                'git',
                ['diff', '--name-only', '--diff-filter=A', '--relative', '-z', range, '--'],
                { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 },
            );
            return new Set(output.split('\0').filter(path => path !== ''));
        } catch {
            // Try the next form of the range.
        }
    }
    return undefined;
}
