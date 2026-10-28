import { execFileSync } from 'node:child_process';

/**
 * The size in bytes of every file git has at `HEAD`, by path relative to `root`: `git ls-tree -r -l`
 * reads the sizes from git's own records, so no file is opened and nothing of its content is read.
 * `undefined` when git cannot say (no repository, no commit yet, no git): a size is a nicety, never a
 * reason to fail.
 */
export function committedSizes(
    root: string,
    env: Readonly<Record<string, string | undefined>> = process.env,
): Map<string, number> | undefined {
    let output: string;
    try {
        output = execFileSync('git', ['-C', root, 'ls-tree', '-r', '-l', '-z', 'HEAD'], {
            encoding: 'utf8',
            env: { ...process.env, ...env },
            maxBuffer: 512 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return undefined;
    }
    return parseSizes(output);
}

/** The records of `ls-tree -l -z`: `<mode> <type> <object> <size>\t<path>`, the size padded with spaces. */
export function parseSizes(output: string): Map<string, number> {
    const sizes = new Map<string, number>();
    for (const record of output.split('\0')) {
        const tab = record.indexOf('\t');
        if (tab === -1) continue;
        const [, type, , size] = record.slice(0, tab).split(/\s+/u, 4);
        // A submodule is a commit, and its size is `-`: not a file of this repository.
        if (type !== 'blob' || size === undefined || !/^\d+$/u.test(size)) continue;
        sizes.set(record.slice(tab + 1), Number(size));
    }
    return sizes;
}
