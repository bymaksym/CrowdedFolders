import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { parseJsonc } from '../core/config/jsonc.ts';
import type { ResolvedConfig } from '../core/config/types.ts';
import { baseName, joinPath, normalisePath, parentOf } from '../core/paths/tree.ts';
import {
    DEFAULT_SUPPRESSIONS,
    parseSuppressions,
    PER_PROJECT,
    projectOf,
    type Suppression,
} from '../core/suppressions.ts';
import { projectDirOf } from './config-file.ts';

/** A suppressions file that cannot be read: not JSON, not the shape, or a suppression kept twice. */
export class SuppressionsFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SuppressionsFileError';
    }
}

/** One suppressions file: where it is, and the folder its keys are relative to. */
export interface StoreFile {
    readonly absolute: string;
    /** Its path relative to the root (as given, when it is outside): what messages and `Suppression.file` say. */
    readonly label: string;
    /** The folder its keys are relative to, relative to the root. */
    readonly base: string;
}

/**
 * Where the suppressions file is, the same for the command and for `lint()`: `suppressions` of the
 * configuration from the configuration's folder, by default `crowded-folders-suppressions.json`
 * in `base`. With `"per-project"` the files are per project instead (`SuppressionFiles` finds them).
 */
export function suppressionsPathFor(
    config: Pick<ResolvedConfig, 'suppressions'>,
    configPath: string | undefined,
    base: string,
    fallback = DEFAULT_SUPPRESSIONS,
): string {
    const configured = config.suppressions;
    const folder = configPath === undefined ? base : projectDirOf(configPath);
    return resolve(configured === undefined ? base : folder, configured ?? fallback);
}

/**
 * The suppressions files of a run: one for the repository (the default, or the one
 * `--suppressions-location` or `"suppressions"` names), or with `"per-project"` one
 * `crowded-folders-suppressions.json` per project, its keys relative to the project. This reads
 * them; the command's store writes them too.
 */
export class SuppressionFiles {
    readonly perProject: boolean;
    protected readonly root: string;
    protected readonly known = new Map<string, StoreFile>();
    protected readonly single: StoreFile | undefined;
    private readonly repositoryFiles: ReadonlySet<string>;

    constructor(root: string, location: string, files: readonly string[]) {
        this.root = root;
        this.perProject = location === PER_PROJECT;
        this.repositoryFiles = new Set(files);
        if (this.perProject) {
            for (const path of files) {
                if (baseName(path) === DEFAULT_SUPPRESSIONS) {
                    this.fileAt(path);
                }
            }
            this.single = undefined;
        } else {
            const absolute = resolve(root, location);
            const inside = relative(root, absolute);
            const label =
                inside.startsWith('..') || isAbsolute(inside) ? absolute : (normalisePath(inside) ?? location);
            this.single = { absolute, label, base: '.' };
            this.known.set(label, this.single);
        }
    }

    /** The files of the repository that are suppressions files: they are never checked as files. */
    ownFiles(): string[] {
        return [...this.known.values()].filter(file => !isAbsolute(file.label)).map(file => file.label);
    }

    /** The file a new suppression of `folder` goes to. */
    readonly fileFor = (folder: string): string => {
        return this.single
            ? this.single.label
            : this.fileAt(joinPath(projectOf(folder, this.repositoryFiles), DEFAULT_SUPPRESSIONS)).label;
    };

    /** Every suppression of every file; a file that is not there holds none. */
    read(): Suppression[] {
        const all: Suppression[] = [];
        const holder = new Map<string, string>();
        for (const file of this.known.values()) {
            if (!existsSync(file.absolute)) {
                continue;
            }
            let value: unknown;
            try {
                value = parseJsonc(readFileSync(file.absolute, 'utf8'));
            } catch (error) {
                throw new SuppressionsFileError(`${file.label} is not valid JSON: ${(error as Error).message}`);
            }
            const parsed = parseSuppressions(value, { file: file.label, base: file.base });
            if (typeof parsed === 'string') {
                throw new SuppressionsFileError(`${file.label} ${parsed}`);
            }
            for (const entry of parsed) {
                const key = `${entry.folder}\0${entry.id}`;
                const other = holder.get(key);
                if (other !== undefined) {
                    throw new SuppressionsFileError(
                        `${entry.folder} → ${entry.id} is suppressed in both ${other} and ${file.label}: keep it in one`,
                    );
                }
                holder.set(key, file.label);
                all.push(entry);
            }
        }
        return all;
    }

    /** The file a `Suppression.file` names: where it is, and the folder its keys start at. */
    readonly locate = (label: string): { readonly absolute: string; readonly base: string } | undefined => {
        return this.known.get(label);
    };

    protected fileAt(label: string): StoreFile {
        const existing = this.known.get(label);
        if (existing) {
            return existing;
        }
        const file = { absolute: resolve(this.root, label), label, base: parentOf(label) };
        this.known.set(label, file);
        return file;
    }
}
