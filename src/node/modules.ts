import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isObject } from '../core/config/json-schema.ts';
import { satisfies } from '../core/config/version-range.ts';

/** Defined by the build of the single-file binary (tooling/build-binary.mjs), nowhere else. */
declare const CROWDED_FOLDERS_BUNDLED_VERSION: string | undefined;

/**
 * The version of this package, from its package.json (two folders up from both src/node and dist/node).
 * The single-file binary has no package.json beside it: its build writes the version in, as a constant.
 */
export const OWN_VERSION = readOwnVersion();

/**
 * Finds a package or file named in a configuration (`plugins`, `extends`) the way a user expects:
 * from the configuration's folder, not from wherever this package happens to be installed. A plugin
 * installed next to the user's project has to be found even when the command runs through `npx`.
 *
 * The package's folder is found in the `node_modules` folders above the configuration, else by Yarn
 * Plug'n'Play's API, else by Node's own `require.resolve` from there (`createRequire`). Its entry is
 * then read from `exports` with the `import` condition, patterns (`"./*"`) included: `require.resolve`
 * alone would apply the `require` condition, and a plugin that only exports `import` — what
 * docs/plugins.md asks for — would not be found.
 */
export function resolveSpecifier(specifier: string, fromDir: string): string {
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
        const path = resolve(fromDir, specifier);
        if (!existsSync(path)) {
            throw new Error(`"${specifier}" does not exist (looked for ${path})`);
        }
        return path;
    }
    const { name, subpath } = splitPackage(specifier);
    const packageDir = packageDirOf(name, fromDir);
    if (packageDir !== undefined) {
        const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as unknown;
        return entryOf(packageDir, manifest, subpath, specifier);
    }
    try {
        return requireFrom(fromDir).resolve(specifier);
    } catch {
        throw new Error(
            `the package "${name}" is not installed where the configuration is (from ${fromDir}): install it as a devDependency`,
        );
    }
}

/** What Yarn Plug'n'Play's runtime API offers that this needs. */
export interface PnpApi {
    resolveToUnqualified(request: string, issuer: string): string | null;
}

/**
 * The folder of an installed package, as seen from `fromDir`; `undefined` when none of the three
 * ways finds it. `pnp` is Yarn's API when the process runs under Plug'n'Play (it is passed in tests).
 */
export function packageDirOf(
    name: string,
    fromDir: string,
    pnp: PnpApi | undefined = pnpApi(fromDir),
): string | undefined {
    for (let dir = fromDir; ; dir = dirname(dir)) {
        const packageDir = join(dir, 'node_modules', name);
        if (existsSync(join(packageDir, 'package.json'))) {
            return packageDir;
        }
        if (dirname(dir) === dir) {
            break;
        }
    }
    if (pnp) {
        try {
            const found = pnp.resolveToUnqualified(name, `${fromDir}/`);
            if (found !== null && existsSync(join(found, 'package.json'))) {
                return found;
            }
        } catch {
            // Not a dependency of the project, for Plug'n'Play: the last way below says so.
        }
    }
    try {
        return dirname(requireFrom(fromDir).resolve(`${name}/package.json`));
    } catch {
        return undefined;
    }
}

/**
 * Why a plugin package cannot run with this version, from what its package.json says
 * (`peerDependencies["crowded-folders"]`); `undefined` when it can, says nothing, or is a local file.
 */
export function compatibilityProblem(specifier: string, entry: string, version = OWN_VERSION): string | undefined {
    if (specifier.startsWith('.') || isAbsolute(specifier)) {
        return undefined;
    }
    const { name } = splitPackage(specifier);
    const manifest = manifestAbove(entry, name);
    const peers = manifest?.['peerDependencies'];
    const range = isObject(peers) ? peers['crowded-folders'] : undefined;
    if (typeof range !== 'string' || satisfies(version, range) !== false) {
        return undefined;
    }
    const own = typeof manifest?.['version'] === 'string' ? ` ${manifest['version']}` : '';
    const major = version.split('.', 1)[0] ?? version;
    return `"${specifier}"${own} is made for crowded-folders ${range} (its peerDependencies), and this is ${version}: install a version of the plugin made for ${major}.x, or the crowded-folders it asks for.`;
}

/** Imports a module by path and returns its default export (or the module itself without one). */
export async function importDefault(path: string): Promise<unknown> {
    const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    return 'default' in module ? module['default'] : module;
}

/** The package.json of the package `name` that holds `path`, read from it upwards. */
function manifestAbove(path: string, name: string): Readonly<Record<string, unknown>> | undefined {
    for (let dir = dirname(path); ; dir = dirname(dir)) {
        const file = join(dir, 'package.json');
        if (existsSync(file)) {
            try {
                const manifest = JSON.parse(readFileSync(file, 'utf8')) as unknown;
                if (isObject(manifest) && manifest['name'] === name) {
                    return manifest;
                }
            } catch {
                // A package.json that does not parse is not the one looked for.
            }
        }
        if (dirname(dir) === dir) {
            return undefined;
        }
    }
}

function requireFrom(dir: string): NodeJS.Require {
    // The file need not exist: it only says where resolution starts.
    return createRequire(join(dir, 'crowded-folders.config.cjs'));
}

function pnpApi(fromDir: string): PnpApi | undefined {
    if (process.versions['pnp'] === undefined) {
        return undefined;
    }
    try {
        return requireFrom(fromDir)('pnpapi') as PnpApi;
    } catch {
        return undefined;
    }
}

function readOwnVersion(): string {
    if (typeof CROWDED_FOLDERS_BUNDLED_VERSION === 'string') {
        return CROWDED_FOLDERS_BUNDLED_VERSION;
    }
    try {
        const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as unknown;
        return isObject(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function splitPackage(specifier: string): { name: string; subpath: string } {
    const parts = specifier.split('/');
    const length = specifier.startsWith('@') ? 2 : 1;
    const subpath = parts.slice(length).join('/');
    return { name: parts.slice(0, length).join('/'), subpath: subpath === '' ? '.' : `./${subpath}` };
}

/** Reads `exports` (the `import`, `node` or `default` condition), then `main`, then `index.js`. */
function entryOf(packageDir: string, manifest: unknown, subpath: string, specifier: string): string {
    if (!isObject(manifest)) {
        throw new Error(`"${specifier}" has a package.json that is not an object`);
    }
    const exportsField = manifest['exports'];
    if (exportsField !== undefined) {
        const target = exportTarget(exportsField, subpath);
        if (target === undefined) {
            throw new Error(`"${specifier}" does not export "${subpath}" in its package.json`);
        }
        return join(packageDir, target);
    }
    if (subpath !== '.') {
        return join(packageDir, subpath);
    }
    const main = typeof manifest['main'] === 'string' ? manifest['main'] : 'index.js';
    const path = join(packageDir, main);
    return existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.js') : path;
}

function exportTarget(field: unknown, subpath: string): string | undefined {
    if (typeof field === 'string') {
        return subpath === '.' ? field : undefined;
    }
    if (Array.isArray(field)) {
        for (const option of field) {
            const target = exportTarget(option, subpath);
            if (target !== undefined) {
                return target;
            }
        }
        return undefined;
    }
    if (!isObject(field)) {
        return undefined;
    }
    const keys = Object.keys(field);
    if (keys.every(key => !key.startsWith('.'))) {
        return subpath === '.' ? conditionTarget(field) : undefined;
    }
    const entry = field[subpath];
    return entry === undefined ? patternTarget(field, keys, subpath) : conditionTarget(entry);
}

/**
 * A subpath pattern, as Node reads it: `"./features/*": "./dist/features/*.js"` takes
 * `./features/x` to `./dist/features/x.js`. The key with the longest part before `*` wins.
 */
function patternTarget(
    field: Readonly<Record<string, unknown>>,
    keys: readonly string[],
    subpath: string,
): string | undefined {
    let best: { readonly key: string; readonly match: string } | undefined;
    for (const key of keys) {
        const star = key.indexOf('*');
        if (star === -1 || key.includes('*', star + 1)) {
            continue;
        }
        const before = key.slice(0, star);
        const after = key.slice(star + 1);
        if (
            subpath.length >= key.length &&
            subpath.startsWith(before) &&
            subpath.endsWith(after) &&
            (best === undefined || before.length > best.key.indexOf('*'))
        ) {
            best = { key, match: subpath.slice(before.length, subpath.length - after.length) };
        }
    }
    if (best === undefined) {
        return undefined;
    }
    const target = conditionTarget(field[best.key]);
    // Joined, not replaced: a replacement string would read "$&" in a path as a pattern.
    return target?.split('*').join(best.match);
}

function conditionTarget(entry: unknown): string | undefined {
    if (typeof entry === 'string') {
        return entry;
    }
    if (Array.isArray(entry)) {
        for (const option of entry) {
            const target = conditionTarget(option);
            if (target !== undefined) {
                return target;
            }
        }
        return undefined;
    }
    if (!isObject(entry)) {
        return undefined;
    }
    for (const condition of ['import', 'node', 'default']) {
        if (entry[condition] === undefined) {
            continue;
        }

        const target = conditionTarget(entry[condition]);
        if (target !== undefined) {
            return target;
        }
    }
    return undefined;
}
