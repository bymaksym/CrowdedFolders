import type { OverrideConfig, Preset } from '../config/types.ts';
import { compareText } from '../naming/modules.ts';
import { compileGlob, type Glob, matchesSelfOrAncestor } from '../paths/glob.ts';
import { parentOf } from '../paths/tree.ts';
import { TEST_DATA } from './general.ts';

export interface Detection {
    readonly preset: string;
    /** What gave it away: a file path or a dependency name. */
    readonly evidence: string;
    /** Every folder it was found in (`.` for the root): where its root-anchored excludes apply. */
    readonly folders: readonly string[];
    /**
     * The presets it extends that were found too, and where: they are not proposed (`react-native`
     * already extends `react`), but their root-anchored excludes still apply in those folders.
     */
    readonly extended?: readonly { readonly preset: string; readonly folders: readonly string[] }[];
}

/**
 * Folders whose files say nothing about what the repository is: tests and their data, examples,
 * playgrounds and the templates a scaffolder copies. bat's tests/syntax-tests hold a go.mod and a
 * main.tf to highlight; vite's playground and create-vite templates depend on react, vue and svelte.
 */
const NOT_EVIDENCE: readonly Glob[] = [
    ...TEST_DATA,
    'node_modules',
    'vendor',
    'third_party',
    'test',
    'tests',
    '__tests__',
    'example',
    'examples',
    'playground',
    'playgrounds',
    'template',
    'templates',
    'template-*',
].map(compileGlob);

/** Whether a file can tell which presets fit: it is not inside tests, examples or templates. */
export function isEvidence(path: string): boolean {
    return !matchesSelfOrAncestor(parentOf(path), NOT_EVIDENCE);
}

/**
 * Which presets fit a repository, from its file paths and the dependencies its package.json files
 * declare (each with the manifests that declare it). `recommended` always comes first; the rest in
 * the order of `presets`.
 *
 * A file is evidence only outside tests, examples and templates, and outside the folders another
 * detected preset leaves out, read from where that preset was found: Flutter's `/linux` next to
 * `app/pubspec.yaml` is `app/linux`, and the CMakeLists.txt Flutter generates there is not C++.
 */
export function detectPresets(
    files: readonly string[],
    dependencies: ReadonlyMap<string, readonly string[]>,
    presets: Readonly<Record<string, Preset>>,
): Detection[] {
    const candidates = files.filter(path => isEvidence(path)).toSorted((a, b) => depthOf(a) - depthOf(b));
    // Nor inside a folder `recommended` leaves out, which every run applies: the CMakeLists.txt in
    // Android's `.cxx` CMake cache is not a C++ project. A pattern that names a dot folder itself
    // (`.vitepress/config.ts`) still finds its file there.
    const leftOutByAll = (presets['recommended']?.config.exclude ?? []).map(compileGlob);
    const kept = new Set(
        candidates.filter(path => parentOf(path) === '.' || !matchesSelfOrAncestor(parentOf(path), leftOutByAll)),
    );
    const found: { readonly preset: string; readonly evidence: string; readonly files: readonly string[] }[] = [];
    for (const [name, preset] of Object.entries(presets)) {
        const detect = preset.detect;
        if (!detect || name === 'recommended') {
            continue;
        }
        const dependency = detect.dependencies?.find(candidate => dependencies.has(candidate));
        if (dependency !== undefined) {
            const manifests = detect.dependencies?.flatMap(candidate => dependencies.get(candidate) ?? []) ?? [];
            found.push({ preset: name, evidence: `the dependency ${dependency}`, files: manifests });
            continue;
        }
        const globs = (detect.files ?? []).map(compileGlob);
        const confirming = confirmingFiles(detect.confirmedBy, candidates);
        const matching = candidates.filter(
            path =>
                globs.some(glob => (kept.has(path) || namesDotFolder(glob)) && glob.test(path)) &&
                (confirming === undefined || confirming.some(file => isUnder(file, parentOf(path)))),
        );
        if (matching.length > 0) {
            found.push({ preset: name, evidence: matching[0] ?? '', files: matching });
        }
    }

    const detections: Detection[] = [{ preset: 'recommended', evidence: 'every repository', folders: ['.'] }];
    for (const detection of found) {
        const leftOut = found
            .filter(other => other !== detection)
            .flatMap(other => other.files.flatMap(file => anchoredExcludes(other.preset, presets, parentOf(file))));
        const evidence = detection.files.filter(file => !matchesSelfOrAncestor(parentOf(file), leftOut));
        // Every file that gave it away is inside what another preset leaves out.
        if (detection.files.length > 0 && evidence.length === 0) {
            continue;
        }
        const folders = [...new Set((evidence.length > 0 ? evidence : ['package.json']).map(file => parentOf(file)))];
        detections.push({
            preset: detection.preset,
            evidence: detection.evidence.startsWith('the dependency ') ? detection.evidence : (evidence[0] ?? ''),
            folders,
        });
    }
    return withoutRedundant(detections, presets);
}

/**
 * Drops the presets another detected preset already extends where that one was found, `react` next
 * to `react-native` or `java` next to `android`: writing both only repeats the parent. Where the
 * child was found inside the parent's folder (an AndroidManifest.xml under the build.gradle), the
 * child applies to the parent's folder too; a parent found elsewhere too stays for those folders (react in
 * apps/web, react-native in apps/mobile). What the parent excludes by anchor stays in `extended`,
 * so it still applies where it was found.
 */
function withoutRedundant(detections: readonly Detection[], presets: Readonly<Record<string, Preset>>): Detection[] {
    const collect = (name: string, seen: Set<string>): Set<string> => {
        for (const parent of presets[name]?.config.extends ?? []) {
            if (seen.has(parent)) {
                continue;
            }
            seen.add(parent);
            collect(parent, seen);
        }
        return seen;
    };
    const ancestorsOf = (name: string): Set<string> => collect(name, new Set());
    const found = detections.map(detection => ({
        detection,
        folders: [...detection.folders],
        extended: [] as { preset: string; folders: string[] }[],
    }));
    for (const parent of found) {
        if (parent.detection.preset === 'recommended') {
            continue;
        }
        for (const child of found) {
            if (child === parent || !ancestorsOf(child.detection.preset).has(parent.detection.preset)) {
                continue;
            }
            for (const folder of parent.folders) {
                const inside = child.folders.filter(own => own === folder || isUnder(own, folder));
                if (inside.length === 0 && child.folders.every(own => !isUnder(folder, own))) {
                    continue;
                }
                if (inside.length > 0 && !child.folders.includes(folder)) {
                    child.folders = [...child.folders, folder];
                }
                parent.folders = parent.folders.filter(own => own !== folder);
                const entry = child.extended.find(other => other.preset === parent.detection.preset);
                if (entry) entry.folders.push(folder);
                else child.extended.push({ preset: parent.detection.preset, folders: [folder] });
            }
        }
    }
    return found
        .filter(({ detection, folders }) => detection.preset === 'recommended' || folders.length > 0)
        .map(({ detection, folders, extended }) => ({
            ...detection,
            folders,
            ...(extended.length > 0 && { extended }),
        }));
}

/**
 * The excludes a detected preset needs that its own patterns cannot say: its root-anchored ones
 * (`/android`, `/ios`), read from each folder it was found in other than the root, and kept only
 * when they leave some file out. localsend's Flutter app is in app/, so `/android` is `app/android`.
 */
export function excludesFor(
    detections: readonly Detection[],
    files: readonly string[],
    presets: Readonly<Record<string, Preset>>,
): string[] {
    const found: { readonly folder: string; readonly pattern: string }[] = [];
    const under = filesUnder(files);
    for (const detection of detections) {
        const sources = [{ preset: detection.preset, folders: detection.folders }, ...(detection.extended ?? [])];
        for (const { preset, folders } of sources) {
            for (const folder of folders) {
                if (folder === '.') {
                    continue;
                }
                for (const pattern of anchoredPatterns(preset, presets)) {
                    const glob = compileGlob(`${folder}/${pattern}`);
                    // Anchored at the folder: only its own files can match. Trying every file of the
                    // repository for each of 400 Gradle modules took 13 s on 12 000 files.
                    if (under(folder).some(file => matchesSelfOrAncestor(file, [glob]))) {
                        found.push({ folder, pattern });
                    }
                }
            }
        }
    }
    return collapseSiblings(found);
}

/**
 * The files under a folder, found by a binary search in the sorted list: every path that starts with
 * `folder/` sits in one run of it. Each folder's answer is kept, for the patterns after the first.
 */
function filesUnder(files: readonly string[]): (folder: string) => readonly string[] {
    // By code unit, as `<` compares in the search below.
    const sorted = files.toSorted(compareText);
    const cache = new Map<string, readonly string[]>();
    return folder => {
        const cached = cache.get(folder);
        if (cached) {
            return cached;
        }
        const prefix = `${folder}/`;
        let low = 0;
        let high = sorted.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if ((sorted[middle] ?? '') < prefix) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        let end = low;
        while (end < sorted.length && (sorted[end] ?? '').startsWith(prefix)) {
            end++;
        }
        const found = sorted.slice(low, end);
        cache.set(folder, found);
        return found;
    };
}

/**
 * The excludes as globs, one per pattern: when three or more folders with the same parent need the
 * same pattern (sixty Angular apps in `apps/`), one glob for all of them says it once.
 */
function collapseSiblings(found: readonly { readonly folder: string; readonly pattern: string }[]): string[] {
    const byParent = new Map<string, Set<string>>();
    for (const { folder, pattern } of found) {
        const key = `${parentOf(folder)}|${pattern}`;
        byParent.set(key, (byParent.get(key) ?? new Set()).add(folder));
    }
    const excludes = new Set<string>();
    for (const { folder, pattern } of found) {
        const parent = parentOf(folder);
        const siblings = byParent.get(`${parent}|${pattern}`);
        excludes.add(
            siblings !== undefined && siblings.size >= COLLAPSE_FROM
                ? `${parent === '.' ? '' : `${parent}/`}*/${pattern}`
                : `${folder}/${pattern}`,
        );
    }
    return [...excludes];
}

/** How many sibling folders make a glob clearer than a line each. */
const COLLAPSE_FROM = 3;

/**
 * The addons of the Godot projects found (`addons/<name>/plugin.cfg`), by project folder. The preset
 * leaves `addons/` out because the guide keeps third-party resources there, but a plugin of your own
 * lives there too: `init` writes one exclusion for each, so that deleting a line puts it back.
 */
export function godotAddons(
    detections: readonly Detection[],
    files: readonly string[],
): { readonly folder: string; readonly names: readonly string[] }[] {
    const projects = detections.find(detection => detection.preset === 'godot')?.folders ?? [];
    const found: { folder: string; names: string[] }[] = [];
    for (const folder of projects) {
        const prefix = folder === '.' ? 'addons/' : `${folder}/addons/`;
        const names = files
            .filter(file => file.startsWith(prefix) && file.endsWith('/plugin.cfg'))
            .map(file => file.slice(prefix.length, -'/plugin.cfg'.length))
            .filter(name => name !== '' && !name.includes('/'))
            .toSorted((a, b) => a.localeCompare(b));
        if (names.length > 0) {
            found.push({ folder, names });
        }
    }
    return found;
}

/** A preset's root-anchored excludes, from it and what it extends, without the leading slash. */
function anchoredPatterns(name: string, presets: Readonly<Record<string, Preset>>): string[] {
    const seen = new Set<string>();
    const collect = (current: string): string[] => {
        const preset = presets[current];
        if (!preset || seen.has(current)) {
            return [];
        }
        seen.add(current);
        const own = (preset.config.exclude ?? [])
            .filter(pattern => pattern.startsWith('/') || pattern.includes('/'))
            .map(pattern => pattern.replace(/^\.?\//u, ''))
            // `**/lib/l10n` already matches at any depth.
            .filter(pattern => !pattern.startsWith('**/'));
        return [...own, ...(preset.config.extends ?? []).flatMap(parent => collect(parent))];
    };
    return collect(name);
}

/** A preset's root-anchored excludes as globs, read from the folder it was found in. */
function anchoredExcludes(name: string, presets: Readonly<Record<string, Preset>>, base: string): Glob[] {
    return anchoredPatterns(name, presets).map(pattern =>
        compileGlob(base === '.' ? `/${pattern}` : `${base}/${pattern}`),
    );
}

/** The files that confirm a preset's evidence (`*.py` for a requirements.txt), or `undefined` when it needs none. */
function confirmingFiles(globs: readonly string[] | undefined, files: readonly string[]): string[] | undefined {
    if (globs === undefined || globs.length === 0) {
        return undefined;
    }
    const compiled = globs.map(compileGlob);
    return files.filter(file => compiled.some(glob => glob.test(file)));
}

function isUnder(path: string, folder: string): boolean {
    return folder === '.' || path.startsWith(`${folder}/`);
}

function namesDotFolder(glob: Glob): boolean {
    return glob.source.startsWith('.') || glob.source.includes('/.');
}

function depthOf(path: string): number {
    return path.split('/').length;
}

/** What `init` writes, and what a run without a configuration uses, from the presets detected. */
export interface DetectedConfig {
    readonly extends: readonly string[];
    readonly exclude: readonly string[];
    readonly overrides: readonly OverrideConfig[];
}

/**
 * The configuration the detected presets make. A preset found at the root goes in `extends`; one
 * found only in sub-folders (a pom.xml in server/, an Angular package.json in web/) goes in an
 * override with `extends`, so that it applies there and not to the rest of the repository. A preset
 * that puts back what recommended leaves out (`"!…"`, as the game presets do with media) cannot be
 * applied to some folders only, and stays in `extends` with its excludes read from where it was found.
 */
export function configFromDetections(
    detections: readonly Detection[],
    files: readonly string[],
    presets: Readonly<Record<string, Preset>>,
): DetectedConfig {
    const isScoped = (detection: Detection): boolean =>
        detection.preset !== 'recommended' &&
        !detection.folders.includes('.') &&
        !negatesExcludes(detection.preset, presets);
    const top = detections.filter(detection => !isScoped(detection));
    return {
        extends: [...new Set(top.map(detection => detection.preset))],
        exclude: excludesFor(top, files, presets),
        overrides: detections
            .filter(detection => isScoped(detection))
            .map(detection => ({
                folders: folderGlobs(detection.folders, files),
                extends: [detection.preset],
                reason: `Where ${detection.preset} was found (${detection.evidence})`,
            })),
    };
}

/** Whether a preset, or one it extends, takes something out of what is left out (`"!*.png"`). */
function negatesExcludes(name: string, presets: Readonly<Record<string, Preset>>, seen = new Set<string>()): boolean {
    const preset = presets[name];
    if (!preset || seen.has(name)) {
        return false;
    }
    seen.add(name);
    return (
        (preset.config.exclude ?? []).some(pattern => pattern.startsWith('!')) ||
        (preset.config.extends ?? []).some(parent => negatesExcludes(parent, presets, seen))
    );
}

/**
 * The globs of an override for these folders: `server/**` each, or `apps/*\/**` when three or more
 * siblings are every folder their parent has (sixty Angular apps in apps/).
 */
function folderGlobs(folders: readonly string[], files: readonly string[]): string[] {
    const byParent = new Map<string, string[]>();
    for (const folder of folders) {
        const parent = parentOf(folder);
        byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
    }
    const globs: string[] = [];
    for (const [parent, siblings] of byParent) {
        if (siblings.length >= COLLAPSE_FROM && childFolders(parent, files).size === siblings.length) {
            globs.push(`${parent === '.' ? '' : `${parent}/`}*/**`);
        } else {
            globs.push(...siblings.map(folder => `${folder}/**`));
        }
    }
    return globs.toSorted((a, b) => a.localeCompare(b));
}

/** The folders directly in `parent` that hold a file, at any depth. */
function childFolders(parent: string, files: readonly string[]): Set<string> {
    const prefix = parent === '.' ? '' : `${parent}/`;
    const children = new Set<string>();
    for (const file of files) {
        if (!file.startsWith(prefix)) {
            continue;
        }
        const rest = file.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash !== -1) {
            children.add(rest.slice(0, slash));
        }
    }
    return children;
}
