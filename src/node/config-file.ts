import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';

import { isObject } from '../core/config/json-schema.ts';
import { duplicateKeys, parseJsonc } from '../core/config/jsonc.ts';
import { ConfigError } from '../core/config/validate.ts';
import { importDefault } from './modules.ts';

/** The names a configuration can have, in the order they are looked for in each folder. */
export const CONFIG_NAMES = [
    'crowded-folders.config.json',
    'crowded-folders.config.jsonc',
    'crowded-folders.config.mjs',
    'crowded-folders.config.js',
    '.config/crowded-folders.json',
    '.config/crowded-folders.jsonc',
    '.config/crowded-folders.mjs',
] as const;

export const PACKAGE_KEY = 'crowded-folders';

export interface FoundConfig {
    /** The file that holds it: a configuration file, or a package.json with a "crowded-folders" key. */
    readonly path: string;
    /** The folder it describes: where it is, or above `.config/`. Relative paths in it start here. */
    readonly projectDir: string;
}

/**
 * Looks for a configuration from `startDir` upwards, stopping at the top of the git repository (or
 * of the disk). Two configurations in one folder is an error rather than a choice: one would be
 * read and the other silently ignored.
 */
export function findConfig(startDir: string): FoundConfig | undefined {
    for (let dir = startDir; ; dir = dirname(dir)) {
        const found = CONFIG_NAMES.map(name => join(dir, name)).filter(path => existsSync(path));
        const manifest = join(dir, 'package.json');
        if (existsSync(manifest) && hasPackageKey(manifest)) {
            found.push(manifest);
        }
        if (found.length > 1) {
            throw new Error(
                `${dir} has more than one crowded-folders configuration (${found.map(path => basename(path)).join(', ')}): keep one, so it is clear which is read.`,
            );
        }
        const [path] = found;
        if (path !== undefined) {
            return { path, projectDir: projectDirOf(path) };
        }
        if (existsSync(join(dir, '.git')) || dirname(dir) === dir) {
            return undefined;
        }
    }
}

/** Whether reading a configuration file runs it: anything but JSON and package.json. */
export function isCode(path: string): boolean {
    const extension = extname(path);
    return extension !== '.json' && extension !== '.jsonc';
}

export function projectDirOf(path: string): string {
    const dir = dirname(path);
    return basename(dir) === '.config' ? dirname(dir) : dir;
}

/** Reads a configuration file of any supported kind and returns what it holds, not yet checked. */
export async function readConfigFile(path: string): Promise<unknown> {
    if (basename(path) === 'package.json') {
        const text = readFileSync(path, 'utf8');
        const manifest = parseJsonc(text);
        refuseDuplicates(path, text, `[${JSON.stringify(PACKAGE_KEY)}]`);
        return isObject(manifest) ? manifest[PACKAGE_KEY] : undefined;
    }
    const extension = extname(path);
    if (extension === '.json' || extension === '.jsonc') {
        const text = readFileSync(path, 'utf8');
        let value: unknown;
        try {
            value = parseJsonc(text);
        } catch (error) {
            throw new Error(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
        }
        refuseDuplicates(path, text, '');
        return value;
    }
    const value = await importDefault(path);
    return typeof value === 'function' ? await (value as () => unknown)() : value;
}

/** Where a run reads from: the configuration, the folder checked, and the folder its paths start from. */
export interface Locations {
    readonly configPath: string | undefined;
    /** The folder whose files are listed and checked. */
    readonly root: string;
    /**
     * The folder the paths of the configuration and of the report start from: the configuration's
     * folder when the root is inside it (`--root android` under a configuration that says `/android`),
     * else the root.
     */
    readonly base: string;
    /** The root seen from the base, `/`-separated: `.` when they are the same folder. */
    readonly scope: string;
}

/**
 * Works out where a run reads from, the same way for the command and for `lint()`. The configuration
 * is looked for from the root when one is given, else from `cwd`: `--root ../other` reads other's
 * configuration and loads other's plugins, never the ones of the folder the command was typed in.
 * The root defaults to the configuration's folder, else the top of the git repository, else `cwd`.
 *
 * Every folder is its real path (`realpathSync.native`), so that a Windows short name
 * (`MAKSYM~1.OST`), a different case of a drive letter or macOS's `/var` → `/private/var` is the same
 * folder as its long form, and relative paths between them do not climb out with `..`.
 */
export function locate(options: {
    readonly cwd: string;
    /** An absolute path that exists. */
    readonly configPath?: string | undefined;
    /** An absolute path that exists. */
    readonly root?: string | undefined;
}): Locations {
    const cwd = realPath(options.cwd);
    const given = options.root === undefined ? undefined : realPath(options.root);
    const configPath = options.configPath === undefined ? findConfig(given ?? cwd)?.path : realPath(options.configPath);
    const projectDir = configPath === undefined ? undefined : projectDirOf(configPath);
    const root = given ?? projectDir ?? gitRootOf(cwd) ?? cwd;
    const inside = projectDir === undefined ? undefined : relative(projectDir, root);
    if (projectDir === undefined || inside === undefined || inside.startsWith('..') || isAbsolute(inside)) {
        return { configPath, root, base: root, scope: '.' };
    }
    return { configPath, root, base: projectDir, scope: inside === '' ? '.' : inside.replaceAll('\\', '/') };
}

/** The real path of something that exists (the long, correctly cased form); the path itself otherwise. */
export function realPath(path: string): string {
    try {
        return realpathSync.native(path);
    } catch {
        return path;
    }
}

/**
 * The top of the git repository that holds `dir`, or `undefined` outside one. Read from the disk, without running git.
 */
export function gitRootOf(dir: string): string | undefined {
    for (let current = dir; ; current = dirname(current)) {
        if (existsSync(join(current, '.git'))) {
            return current;
        }
        if (dirname(current) === current) {
            return undefined;
        }
    }
}

/**
 * A key written twice: JSON keeps the second in silence, so two `"rules"` lose the first. `within` is
 * the part of the file that is the configuration (the key of package.json), empty for all of it.
 */
function refuseDuplicates(path: string, text: string, within: string): void {
    const duplicates = duplicateKeys(text).filter(
        duplicate =>
            within === '' ||
            duplicate.at === within ||
            duplicate.at.startsWith(`${within}.`) ||
            duplicate.at.startsWith(`${within}[`),
    );
    if (duplicates.length === 0) {
        return;
    }
    throw new ConfigError(
        path,
        duplicates.map(({ at, key, lines }) => ({
            at: at === '' ? JSON.stringify(key) : `${at}.${key}`,
            message: `is written twice (lines ${lines[0]} and ${lines[1]}), and only the second would be read: keep one`,
        })),
    );
}

function hasPackageKey(manifest: string): boolean {
    try {
        const value = parseJsonc(readFileSync(manifest, 'utf8'));
        return isObject(value) && value[PACKAGE_KEY] !== undefined;
    } catch {
        return false;
    }
}
