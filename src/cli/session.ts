import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { isObject } from '../core/config/json-schema.ts';
import { parseJsonc } from '../core/config/jsonc.ts';
import { normalisePath, parentOf } from '../core/paths/tree.ts';
import { type Detection, detectPresets, excludesFor, isEvidence } from '../core/presets/detect.ts';
import { BUILT_IN_PRESETS } from '../core/presets/index.ts';
import { findConfig, gitRootOf, projectDirOf } from '../node/config-file.ts';
import { listFiles, parseFileList } from '../node/files.ts';
import { loadConfig, loadConfigFile, type LoadedConfig } from '../node/load-config.ts';
import { type Args, UsageError } from './args.ts';
import type { Io } from './io.ts';

/** Everything a command needs: where the repository is, its files and its configuration. */
export interface Session {
    readonly root: string;
    /** The configuration file read, or `undefined` when the presets were detected or given with --preset. */
    readonly configPath: string | undefined;
    readonly loaded: LoadedConfig;
    readonly files: readonly string[];
    readonly fileSource: string;
    /** Set when there was no configuration file and the presets were detected. */
    readonly detected: readonly Detection[] | undefined;
}

export async function openSession(args: Args, io: Io): Promise<Session> {
    const configPath = args.config === undefined ? findConfig(io.cwd)?.path : resolve(io.cwd, args.config);
    if (configPath !== undefined && !existsSync(configPath)) {
        throw new UsageError(`--config ${args.config ?? ''}: ${configPath} does not exist`);
    }
    const root = rootOf(args, io, configPath);

    let files: string[];
    let fileSource: string;
    if (args.stdin) {
        files = parseFileList(await io.readStdin());
        fileSource = 'standard input';
    } else {
        const list = listFiles(root, { git: args.git });
        files = [...list.files];
        fileSource = list.source === 'git' ? 'git' : 'the disk';
    }

    let loaded: LoadedConfig;
    let detected: Detection[] | undefined;
    if (configPath === undefined) {
        let presets = args.presets;
        let exclude: string[] = [];
        if (presets.length === 0) {
            const manifests = dependenciesOf(root, files);
            warnIfTruncated(manifests, io);
            detected = detectPresets(files, manifests.names, BUILT_IN_PRESETS);
            presets = detected.map(detection => detection.preset);
            exclude = excludesFor(detected, files, BUILT_IN_PRESETS);
        }
        loaded = await loadConfig({ extends: presets, exclude }, '(the command line)', root);
    } else {
        loaded = await loadConfigFile(configPath);
        if (args.presets.length > 0) {
            loaded = await loadConfig(
                { extends: [...args.presets, configPath] },
                '(the command line)',
                dirname(configPath),
            );
        }
    }
    return { root, configPath, loaded, files, fileSource, detected };
}

/** Turns paths given on the command line into folders relative to the root. */
export function foldersFromPaths(paths: readonly string[], session: Session, cwd: string): string[] {
    const files = new Set(session.files);
    return paths.map(path => {
        const absolute = isAbsolute(path) ? path : resolve(cwd, path);
        const relativePath = relative(session.root, absolute);
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
            throw new UsageError(`${path} is outside the folder being checked (${session.root})`);
        }
        const normalised = normalisePath(relativePath) ?? '.';
        return files.has(normalised) ? parentOf(normalised) : normalised;
    });
}

function rootOf(args: Args, io: Io, configPath: string | undefined): string {
    if (args.root !== undefined) {
        const root = resolve(io.cwd, args.root);
        if (!existsSync(root)) {
            throw new UsageError(`--root ${args.root}: ${root} does not exist`);
        }
        return root;
    }
    if (configPath !== undefined) {
        return projectDirOf(configPath);
    }
    // The root is never just "wherever the command was typed": from a subfolder it is the repository.
    return gitRootOf(io.cwd) ?? io.cwd;
}

/**
 * How many package.json files are read to detect presets, the shallowest first. They are small, so a
 * monorepo with hundreds is read whole (a NestJS service in services/api must not depend on how many
 * packages come before it); the cap is only a bound for a repository with tens of thousands.
 */
export const MAX_MANIFESTS = 5000;

/** What the package.json files declare, and how many were left unread because of the cap. */
export interface Manifests {
    /** Each dependency name with the manifests that declare it. */
    readonly names: Map<string, string[]>;
    readonly skipped: number;
}

/** Says on standard error when detection did not read every package.json, so that a missing preset is not a mystery. */
export function warnIfTruncated(manifests: Manifests, io: Io): void {
    if (manifests.skipped > 0) {
        io.error(
            `crowded-folders: read the ${MAX_MANIFESTS} shallowest package.json files to detect presets and left ${manifests.skipped} unread: a preset only declared in those may be missing (pass --preset to add it).\n`,
        );
    }
}

/**
 * The dependency names of the repository's package.json files, each with the manifests that declare
 * it, for detecting presets and where they apply.
 */
export function dependenciesOf(root: string, files: readonly string[], limit = MAX_MANIFESTS): Manifests {
    const names = new Map<string, string[]>();
    const all = files
        .filter(path => (path === 'package.json' || path.endsWith('/package.json')) && isEvidence(path))
        .toSorted((a, b) => a.split('/').length - b.split('/').length);
    const manifests = all.slice(0, limit);
    for (const manifest of manifests) {
        try {
            const value = parseJsonc(readFileSync(join(root, manifest), 'utf8'));
            if (!isObject(value)) {
                continue;
            }
            for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
                const dependencies = value[field];
                if (isObject(dependencies)) {
                    for (const name of Object.keys(dependencies)) {
                        const declaring = names.get(name) ?? [];
                        if (!declaring.includes(manifest)) {
                            names.set(name, [...declaring, manifest]);
                        }
                    }
                }
            }
        } catch {
            // A package.json that does not parse says nothing about presets.
        }
    }
    return { names, skipped: all.length - manifests.length };
}
