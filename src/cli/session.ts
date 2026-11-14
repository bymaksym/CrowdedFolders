import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { ResolvedConfig, RuleSetting } from '../core/config/types.ts';
import { compileGlob, matchesSelfOrAncestor } from '../core/paths/glob.ts';
import { FileListError, isAbsolutePath, normaliseFileList } from '../core/paths/input.ts';
import { closest } from '../core/paths/suggest.ts';
import { baseName, normalisePath, parentOf } from '../core/paths/tree.ts';
import { plural } from '../core/plural.ts';
import { configFromDetections, type Detection } from '../core/presets/detect.ts';
import { BUILT_IN_PRESETS } from '../core/presets/index.ts';
import { shownPath } from '../node/config/error.ts';
import { gitRootOf, locate, misnamedConfigs, nestedConfigs, realPath } from '../node/config/file.ts';
import { listFiles, markedByAttributes, parseFileList } from '../node/files.ts';
import { ConfigError, loadConfig, loadConfigFile, type LoadedConfig } from '../node/load-config.ts';
import { suppressionsPathFor } from '../node/suppressions-files.ts';
import { type Args, COMMANDS, UsageError } from './args.ts';
import { ciVariable } from './ci.ts';
import { presetsWithoutConfiguration } from './detection.ts';
import type { Io } from './io.ts';

/** Deeper than this, a tree is generated, not arranged: its files are left out, and the run says so. */
export const MAX_DEPTH = 256;

/** Everything a command needs: where the repository is, its files and its configuration. */
export interface Session {
    /** The folder whose files are listed and checked, as its real path. */
    readonly root: string;
    /** The folder the paths of the configuration and of the report start from (see `Locations`). */
    readonly base: string;
    /** The root seen from the base: `.` when they are the same folder. */
    readonly scope: string;
    /** The folder the command was typed in, as its real path: relative paths on the command line start here. */
    readonly cwd: string;
    /** The configuration file read, or `undefined` when the presets were detected or given with --preset. */
    readonly configPath: string | undefined;
    readonly loaded: LoadedConfig;
    /** Relative to `base`. */
    readonly files: readonly string[];
    readonly fileSource: string;
    /** Set when there was no configuration file and the presets were detected. */
    readonly detected: readonly Detection[] | undefined;
    /** The folders checked when no path is given: `undefined` for all of them. */
    readonly only: readonly string[] | undefined;
    /** Said on standard error before the report: how the files were read, and what does nothing. */
    readonly notices: readonly string[];
}

export async function openSession(args: Args, io: Io): Promise<Session> {
    const cwd = realPath(io.cwd);
    const configArg = args.config === undefined ? undefined : resolve(cwd, args.config);
    // `init --config x.json` names the file to create: it does not exist yet, and nothing is read from it.
    const writesConfig = args.command === 'init';
    if (configArg !== undefined && !writesConfig && !existsSync(configArg)) {
        throw new UsageError(`--config ${args.config ?? ''}: ${configArg} does not exist`);
    }
    const rootArg = args.root === undefined ? undefined : resolve(cwd, args.root);
    if (rootArg !== undefined && !existsSync(rootArg)) {
        throw new UsageError(`--root ${args.root ?? ''}: ${rootArg} does not exist`);
    }
    if (rootArg !== undefined && !statSync(rootArg).isDirectory()) {
        throw new UsageError(`--root ${args.root ?? ''}: ${rootArg} is a file; the root is a folder`);
    }
    const projectArg = projectOf(args, cwd);
    // --project reads the repository's configuration: it is looked for from the top of the git repository.
    const start = projectArg === undefined ? cwd : (gitRootOf(projectArg) ?? projectArg);
    const { configPath, root, base, scope, project } = locate({
        cwd: start,
        configPath: writesConfig ? undefined : configArg,
        root: rootArg,
    });
    const projectFolder = projectArg === undefined ? project : within(base, projectArg);
    if (projectArg !== undefined && projectFolder === undefined) {
        throw new UsageError(
            `--project ${args.project ?? ''}: ${projectArg} is outside ${base}, the folder of the repository's configuration`,
        );
    }
    const notices: string[] = [];

    let listed: string[];
    let fileSource: string;
    let only: string[] | undefined = scope === '.' ? undefined : [scope];
    if (projectFolder !== undefined && projectFolder !== '.') {
        only = [projectFolder];
    }
    if (args.stdin) {
        const read = await filesFromStdin(io, cwd, root, notices);
        listed = read.files;
        only = read.under === undefined ? only : [joinScope(scope, read.under)];
        fileSource = 'standard input';
    } else {
        const ci = ciVariable(io.env);
        const list = listFiles(root, {
            git: args.git,
            requireGit: args.requireGit ?? ci !== undefined,
            ...(args.requireGit === undefined && ci !== undefined && { requiredBy: ci }),
            trackedOnly: args.trackedOnly ?? ci !== undefined,
            env: io.env,
        });
        listed = [...list.files];
        fileSource = list.source === 'git' ? 'git' : 'the disk';
        if (list.notice !== undefined) {
            notices.push(list.notice);
        }
    }
    const files = leaveOutDeep(scope === '.' ? listed : listed.map(file => `${scope}/${file}`), notices);

    let loaded: LoadedConfig;
    let detected: Detection[] | undefined;
    const nested = nestedConfigs(files, base, configPath);
    const options = { code: args.code, base, nested };
    if (writesConfig) {
        // `init` writes the configuration: it needs the files, not what an old one says.
        loaded = await loadConfig({}, '(init)', base);
    } else if (configPath === undefined) {
        detected = presetsWithoutConfiguration(args, base, files, io);
        const made = configFromDetections(detected, files, BUILT_IN_PRESETS);
        loaded = await loadConfig(
            { extends: made.extends, exclude: made.exclude, overrides: made.overrides },
            '(the command line)',
            base,
            {},
            options,
        );
        for (const name of new Set([...misnamedConfigs(base), ...misnamedConfigs(cwd)])) {
            notices.push(
                `${name} is not a name crowded-folders reads, so it was not used: rename it to crowded-folders.config.json (or .config/crowded-folders.json).`,
            );
        }
    } else {
        loaded = await loadConfigFile(configPath, {}, options);
        if (args.presets.length > 0) {
            const own = loaded.own;
            const layered = await loadConfig(
                { extends: [...args.presets, configPath] },
                '(the command line)',
                dirname(configPath),
                {},
                options,
            );
            loaded = { ...layered, own };
        }
    }

    notices.push(...loaded.warnings);
    if (writesConfig) {
        return { root, base, scope, cwd, configPath, loaded, files, fileSource, detected, only, notices };
    }
    checkSelection({ files, loaded, configPath, scope, base, cwd, notices, args });
    if (projectArg === undefined && project !== undefined && configPath !== undefined) {
        notices.push(
            `the configuration of ${project} says "root": false, so ${shown(cwd, configPath)} is used, from ${shown(cwd, root)}, and only ${project} is checked`,
        );
    }
    if (args.root !== undefined || scope !== '.') {
        const from = scope === '.' ? '' : `; its paths start at ${shown(cwd, base)}, so the report's do too`;
        notices.push(
            `configuration ${configPath === undefined ? 'none' : shown(cwd, configPath)}, root ${shown(cwd, root)}${from}`,
        );
    }
    return { root, base, scope, cwd, configPath, loaded, files, fileSource, detected, only, notices };
}

/** `--project <dir>`, as a real path, after checking that it is a folder. */
function projectOf(args: Args, cwd: string): string | undefined {
    if (args.project === undefined) {
        return undefined;
    }
    const path = resolve(cwd, args.project);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
        throw new UsageError(`--project ${args.project}: ${path} is not a folder`);
    }
    return realPath(path);
}

/**
 * Turns paths given on the command line (relative to where it was typed, like every path option)
 * into folders of the report. A file stands for its folder; a file that is gone (a deletion in
 * `git diff --name-only`) for the folder it was in. A path that names nothing is an error with the
 * closest name, never a clean run over nothing: `src/no-existe`, `SRC/LIB` for `src/lib`, `explian`.
 */
export function foldersFromPaths(paths: readonly string[], session: Session, cwd: string): string[] {
    const here = realPath(cwd);
    const files = new Set(session.files);
    let folders: Set<string> | undefined;
    const known = (): Set<string> => (folders ??= foldersOf(session.files));
    const has = (path: string): boolean => path === '.' || known().has(path);

    return paths.map((path, index) => {
        const lexical = resolve(here, path);
        const lexicalPath = within(session.root, lexical);
        if (lexicalPath !== undefined) {
            const candidate = joinScope(session.scope, lexicalPath);
            if (files.has(candidate)) return parentOf(candidate);
            if (has(candidate)) return candidate;
        }
        const real = existsSync(lexical) ? realPath(lexical) : undefined;
        const realPathInRoot = real === undefined ? undefined : within(session.root, real);
        if (
            realPathInRoot !== undefined &&
            lexicalPath !== undefined &&
            realPathInRoot !== lexicalPath &&
            realPathInRoot.toLowerCase() === lexicalPath.toLowerCase()
        ) {
            const meant = shown(here, join(session.root, realPathInRoot));
            throw new UsageError(
                `${path} is written with another case than the folder on disk; did you mean ${meant}? (git tells them apart, and so does Linux)`,
            );
        }
        const inRoot = realPathInRoot ?? lexicalPath;
        if (inRoot === undefined) {
            throw new UsageError(`${path} is outside the folder being checked (${shownPath(here, session.root)})`);
        }
        const folder = joinScope(session.scope, inRoot);
        if (files.has(folder)) return parentOf(folder);
        if (has(folder)) return folder;
        if (real !== undefined) {
            // On the disk, but no file in it is checked (empty, ignored or excluded): nothing to report.
            return statSync(real).isDirectory() ? folder : parentOf(folder);
        }
        const parent = parentOf(folder);
        if (baseName(folder).lastIndexOf('.') > 0 && (has(parent) || existsSync(dirname(lexical)))) {
            return parent;
        }
        throw new UsageError(notFound(path, index, folder, known(), here, session.base));
    });
}

/**
 * The suppressions file: `--suppressions-location` from where the command was typed, as every path
 * option; `suppressions` in the configuration from the configuration's folder; by default next to it.
 */
export function suppressionsPathOf(args: Args, session: Session, fallback: string): string {
    return args.suppressionsLocation === undefined
        ? suppressionsPathFor(session.loaded.config, session.configPath, session.base, fallback)
        : resolve(session.cwd, args.suppressionsLocation);
}

/** Says so when a file was written outside the folder being checked: `-o ../../x.json` is allowed, not silent. */
export function noticeIfOutside(io: Io, session: Session, path: string): void {
    if (within(session.root, path) === undefined) {
        io.error(
            `crowded-folders: wrote ${shownPath(session.cwd, path)}, outside the folder being checked (${shownPath(session.cwd, session.root)}).\n`,
        );
    }
}

/**
 * The list from standard input, as files of the root. From a subfolder, `git ls-files` and
 * `git ls-tree` print paths from that folder, so when more of them exist there than at the root they
 * are read from there (and only that folder is checked: the list holds nothing else). Absolute paths
 * under the root are made relative to it; any other is an error. What `.gitattributes` marks as
 * generated is left out, as it is from git's own list.
 */
async function filesFromStdin(
    io: Io,
    cwd: string,
    root: string,
    notices: string[],
): Promise<{ readonly files: string[]; readonly under: string | undefined }> {
    let lines = parseFileList(await io.readStdin());
    let under: string | undefined;
    const here = within(root, cwd);
    if (here !== undefined && here !== '.') {
        const sample = lines.filter(line => !isAbsolutePath(line)).slice(0, 200);
        const fromHere = sample.filter(line => existsSync(join(cwd, line))).length;
        const fromRoot = sample.filter(line => existsSync(join(root, line))).length;
        if (fromHere > fromRoot) {
            under = here;
            lines = lines.map(line => (isAbsolutePath(line) ? line : `${here}/${line}`));
        } else if (fromRoot * 2 < sample.length) {
            notices.push(
                `${sample.length - fromRoot} of the ${plural(sample.length, 'path')} looked at from standard input do not exist under the root (${root}): they are read from the root, not from the current folder (${here}).`,
            );
        }
    }
    const { files, problems } = normaliseFileList(lines, root);
    if (problems.length > 0) {
        throw new UsageError(`--stdin: ${new FileListError(problems).message}`);
    }
    if (files.length === 0 || gitRootOf(root) === undefined) {
        return { files, under };
    }
    const marked = markedByAttributes(root, files);
    if (marked === undefined) {
        notices.push(
            'git could not read .gitattributes for the list from standard input: what it marks linguist-generated or linguist-vendored is counted.',
        );
        return { files, under };
    }
    return { files: marked.size === 0 ? files : files.filter(file => !marked.has(file)), under };
}

function leaveOutDeep(files: string[], notices: string[]): string[] {
    const isDeep = (path: string): boolean => {
        let depth = 0;
        for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
            if (++depth > MAX_DEPTH) return true;
        }
        return false;
    };
    const deep = files.filter(path => isDeep(path));
    if (deep.length === 0) {
        return files;
    }
    const first = deep[0] ?? '';
    const shownPath = `${first.split('/').slice(0, 3).join('/')}/…`;
    notices.push(
        `${plural(deep.length, 'file')} deeper than ${MAX_DEPTH} folders left out (the first in ${shownPath}): a tree that deep is generated, not arranged by hand.`,
    );
    const kept = new Set(deep);
    return files.filter(path => !kept.has(path));
}

/** What the configuration's `include` and `exclude` do to the list: an `include` that takes nothing is an error. */
function checkSelection(context: {
    readonly files: readonly string[];
    readonly loaded: LoadedConfig;
    readonly configPath: string | undefined;
    readonly scope: string;
    readonly base: string;
    readonly cwd: string;
    readonly notices: string[];
    readonly args: Args;
}): void {
    const { files, loaded, configPath, scope, base, cwd, notices, args } = context;
    const { config } = loaded;
    const origin = configPath === undefined ? '(the command line)' : shown(cwd, configPath);
    const exclude = config.exclude.map(compileGlob);
    if (scope !== '.') {
        const leaving = exclude.find(glob => matchesSelfOrAncestor(scope, [glob]));
        if (leaving) {
            throw new UsageError(
                `--root ${args.root ?? scope}: ${origin} leaves out ${scope} ("${leaving.source}" in exclude, read from ${shown(cwd, base)}), so nothing in it would be checked. Give it a configuration of its own, inside it.`,
            );
        }
    }
    if (config.include.length > 0 && files.length > 0) {
        const include = config.include.map(compileGlob);
        const isTaken = files.some(
            file => matchesSelfOrAncestor(file, include) && !matchesSelfOrAncestor(file, exclude),
        );
        if (!isTaken) {
            throw new ConfigError(origin, [
                {
                    at: 'include',
                    message: `${config.include.map(pattern => `"${pattern}"`).join(', ')} takes none of the ${plural(files.length, 'file')} listed, so nothing would be checked. Paths start at ${shown(cwd, base)}; a name takes the folder and everything in it ("src"), and a pattern with "/" is anchored there.`,
                },
            ]);
        }
    }
    if (configPath === undefined) {
        return;
    }
    for (const key of ['include', 'exclude'] as const) {
        for (const pattern of loaded.own[key]) {
            const glob = compileGlob(pattern);
            if (!pattern.startsWith('!') && files.every(file => !matchesSelfOrAncestor(file, [glob]))) {
                notices.push(`${origin}: "${pattern}" in ${key} matches no file: remove it, or fix it.`);
            }
        }
    }
    if (asksForDotfiles(config) && config.exclude.includes('.*')) {
        notices.push(
            `max-files counts dot-files (dotfiles: true), but ".*" in exclude (from recommended) leaves every dot-file and dot-folder out before any rule sees them: add "!.*" and ".*/" to exclude to leave out only the dot-folders.`,
        );
    }
    if (noRuleIsOn(config)) {
        notices.push(`no rule is on in ${origin}, so nothing is checked: missing "extends": ["recommended"]?`);
    }
}

/** Whether `max-files` is set to count dot-files, for the whole tree or in an override. */
function asksForDotfiles(config: ResolvedConfig): boolean {
    const inOverride = config.overrides.some(override => {
        const setting: RuleSetting | undefined = override.rules['max-files'];
        const options = typeof setting === 'string' ? undefined : setting?.[1];
        return options?.['dotfiles'] === true;
    });
    return config.rules['max-files']?.options['dotfiles'] === true || inOverride;
}

/** Whether the configuration turns no rule on (`{}` without `extends`): nothing is checked. */
export function noRuleIsOn(config: ResolvedConfig): boolean {
    const isOff = (setting: string | readonly unknown[]): boolean =>
        (typeof setting === 'string' ? setting : setting[0]) === 'off';
    return (
        Object.values(config.rules).every(state => state.severity === 'off') &&
        config.overrides.every(override => Object.values(override.rules).every(setting => isOff(setting)))
    );
}

function notFound(
    path: string,
    index: number,
    folder: string,
    folders: ReadonlySet<string>,
    here: string,
    base: string,
): string {
    if (index === 0 && !/[\\/.]/u.test(path)) {
        if (path.toLowerCase() === 'help') {
            return `${path} is not a folder here; for the help, run crowded-folders --help`;
        }
        const command = closest(path, COMMANDS);
        if (command !== undefined) {
            return `${path} is not a folder here; did you mean the command ${command}? (crowded-folders ${command} …)`;
        }
    }
    const depth = folder.split('/').length;
    const guess = closest(
        folder,
        [...folders].filter(candidate => candidate.split('/').length === depth),
    );
    return `${path} does not exist${guess === undefined ? '' : `; did you mean ${shown(here, join(base, guess))}?`}`;
}

/** Every folder that holds a checked file, and every folder above them. */
function foldersOf(files: readonly string[]): Set<string> {
    const folders = new Set<string>();
    for (const file of files) {
        for (let folder = parentOf(file); folder !== '.' && !folders.has(folder); folder = parentOf(folder)) {
            folders.add(folder);
        }
    }
    return folders;
}

/** A path inside `root`, relative to it and `/`-separated (`.` for the root itself); `undefined` outside it. */
export function within(root: string, path: string): string | undefined {
    const inside = relative(root, path);
    if (inside === '') {
        return '.';
    }
    return inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)
        ? undefined
        : (normalisePath(inside) ?? '.');
}

export function joinScope(scope: string, path: string): string {
    return scope === '.' ? path : path === '.' ? scope : `${scope}/${path}`;
}

/** A path for a message: from where the command was typed when it is under it, else absolute. */
function shown(cwd: string, path: string): string {
    const inside = within(cwd, path);
    return inside ?? path;
}
