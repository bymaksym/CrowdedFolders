import { compileGlob, trimSlashes } from '../paths/glob.ts';
import type { Config, OverrideConfig, Preset } from './types.ts';

/**
 * Globs written for one folder, read from another. A configuration's globs start at its own folder;
 * when it is applied to a folder below the run's base (a preset under `overrides[].extends`, the
 * configuration of a package with `"root": false`) or comes from a folder above it (a shared
 * `base.json` at the top of a monorepo, extended from a package), they are rewritten so that they
 * mean the same folders as seen from the base.
 */

/**
 * A glob written from the folder `folder` (a path from the base, possibly with globs of its own, as in
 * `apps/*`), as a glob from the base. A pattern without `/` matches at any depth, so it does below
 * `folder` too; a root-anchored one (`/target`, `src/app`) starts at `folder`; `.` is `folder` itself.
 */
export function globUnder(folder: string, glob: string): string {
    if (glob.startsWith('!')) {
        return `!${globUnder(folder, glob.slice(1))}`;
    }
    if (folder === '.' || folder === '') {
        return glob;
    }
    if (['.', './', '/'].includes(glob)) {
        return folder;
    }
    const isRooted = glob.startsWith('/') || glob.startsWith('./');
    const trimmed = trimSlashes(glob.startsWith('./') ? glob.slice(2) : glob);
    if (!isRooted && !trimmed.includes('/')) {
        return trimmed === '**' ? `${folder}/**` : `${folder}/**/${trimmed}`;
    }
    return `${folder}/${trimmed}`;
}

/** What a glob from a folder above the base becomes from the base. */
export type FromAbove =
    | { readonly kind: 'glob'; readonly glob: string }
    /** The glob names the base itself, or a folder that holds it. */
    | { readonly kind: 'base' }
    /** It can only match outside the base. */
    | { readonly kind: 'outside' };

/**
 * A glob written from a folder above the base, which is `path` below it (`packages/a`), as a glob
 * from the base. `packages/*\/src/**` from the top of the monorepo is `src/**` from `packages/a`;
 * `packages/b/**` matches nothing there; a name at any depth (`generated`, `**\/legacy`) stays as it is.
 */
export function globFromAbove(path: string, glob: string): FromAbove {
    if (glob.startsWith('!')) {
        const inner = globFromAbove(path, glob.slice(1));
        return inner.kind === 'glob' ? { kind: 'glob', glob: `!${inner.glob}` } : inner;
    }
    const isRooted = glob.startsWith('/') || glob.startsWith('./');
    const trimmed = trimSlashes(glob.startsWith('./') ? glob.slice(2) : glob);
    if (trimmed === '.' || trimmed === '') {
        return { kind: 'outside' };
    }
    if (!isRooted && !trimmed.includes('/')) {
        return { kind: 'glob', glob };
    }
    // A "/" inside braces is not a separator of segments; such a glob is read as it is.
    if (hasSlashInBraces(trimmed)) {
        return { kind: 'glob', glob };
    }
    const segments = trimmed.split('/');
    let index = 0;
    for (const folder of path.split('/')) {
        const segment = segments[index];
        if (segment === undefined) {
            // The glob ended at a folder above the base, or at the base: it names one of them.
            return { kind: 'base' };
        }
        if (segment === '**') {
            return { kind: 'glob', glob: segments.slice(index).join('/') };
        }
        if (!compileGlob(`/${segment}`).test(folder)) {
            return { kind: 'outside' };
        }
        index++;
    }
    const rest = segments.slice(index).join('/');
    if (rest === '') {
        return { kind: 'base' };
    }
    // From the base, a rest without "/" would match at any depth: anchor it.
    return { kind: 'glob', glob: rest.includes('/') ? rest : `/${rest}` };
}

function hasSlashInBraces(glob: string): boolean {
    let depth = 0;
    for (const char of glob) {
        if (char === '{') depth++;
        else if (char === '}') depth = Math.max(0, depth - 1);
        else if (char === '/' && depth > 0) return true;
    }
    return false;
}

/** Where some settings apply: the folders of an override with `extends`, or of a package configuration. */
export interface Scope {
    readonly folders: readonly string[];
    /** What root-anchored patterns start from: the folders, without a final `/**`. */
    readonly bases: readonly string[];
    readonly withFiles: readonly string[];
    readonly reason: string;
    /** Whether files may be extended here (a package configuration), or presets only (an override). */
    readonly allowsFiles: boolean;
    /** What was applied in this scope, so that each preset is applied once in it. */
    readonly applied: Set<string>;
    /** Rules a preset of this scope keeps from a preset that tightens. */
    readonly kept: Map<string, string>;
}

/** The entries of an `extends`, with the presets that tighten moved after the rest, in their order. */
export function tighteningLast(entries: readonly string[], presets: Readonly<Record<string, Preset>>): string[] {
    const isTightening = (entry: string): boolean => presets[entry]?.tightens === true;
    return [...entries.filter(entry => !isTightening(entry)), ...entries.filter(entry => isTightening(entry))];
}

export function scopeOf(
    folders: readonly string[],
    withFiles: readonly string[],
    reason: string,
    allowsFiles: boolean,
): Scope {
    const bases = [
        ...new Set(
            folders.map(glob => {
                const base = glob.endsWith('/**') ? glob.slice(0, -3) : glob;
                return base === '**' || base === '.' ? '' : base;
            }),
        ),
    ];
    return { folders, bases, withFiles, reason, allowsFiles, applied: new Set(), kept: new Map() };
}

/**
 * A configuration written in a folder above the base, which is `below` it (`packages/a`), as read
 * from the base: its globs are read from its own folder, and what can only match outside the base is
 * dropped. A pattern that names the base or a folder holding it becomes `**` (in include and
 * exclude) or `.` (in overrides).
 */
export function fromFolderAbove(config: Config, below: string): Config {
    const files = (globs: readonly string[] | undefined): string[] | undefined =>
        globs?.flatMap(glob => {
            const read = globFromAbove(below, glob);
            if (read.kind === 'outside') return [];
            return [read.kind === 'base' ? `${glob.startsWith('!') ? '!' : ''}**` : read.glob];
        });
    const overrides: OverrideConfig[] = [];
    for (const override of config.overrides ?? []) {
        const folders = override.folders
            .map(glob => globFromAbove(below, glob))
            .filter(read => read.kind !== 'outside')
            .map(read => (read.kind === 'base' ? '.' : read.glob));
        if (folders.length > 0) {
            overrides.push({ ...override, folders });
        }
    }
    const include = files(config.include);
    const exclude = files(config.exclude);
    return { ...config, ...(include && { include }), ...(exclude && { exclude }), overrides };
}
