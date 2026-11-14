import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { CONFIG_RULES } from '../../core/report/describe.ts';
import type { Report } from '../../core/report/report.ts';
import { firstPlaceOf } from '../../node/config/error.ts';
import { findConfig, gitRootOf } from '../../node/config/file.ts';
import { ConfigError } from '../../node/load-config.ts';
import type { Args } from '../args.ts';
import type { Io } from '../io.ts';
import { TOOL } from '../tool.ts';
import { hiddenFolders } from './build.ts';
import { emit, resolveFormat } from './emit.ts';
import { reportRefusal } from './output-paths.ts';

/** The formats that tell a CI step what went wrong, not only a person reading the log. */
const FAILURE_FORMATS = new Set(['azure', 'github', 'gitlab', 'markdown', 'sarif']);

/**
 * A run that ends with exit code 2 still leaves what a CI step reads: the SARIF file with
 * `executionSuccessful: false` (so `upload-sarif` does not fail later on "path does not exist" and
 * bury the cause), GitLab's report empty (`[]`: it has no way to say a run failed, and a missing artifact
 * is a second error that hides the first), and in the annotation formats an error on the configuration
 * file, on the line of its first problem when that is known. JSON and Checkstyle get nothing: the scripts
 * and tools that read them look at the exit code first. Never throws: the error being reported is the one
 * that matters.
 */
export function writeFailureReports(args: Args, io: Io, error: unknown): void {
    try {
        if (args.command !== 'check') {
            return;
        }
        const configs = configPathsOf(args, io);
        // Never over a file the run refused to write (the configuration, a tracked file): the failure
        // may be that refusal.
        const outputs = args.outputs.filter(
            spec =>
                FAILURE_FORMATS.has(resolveFormat(spec.format, io.env)) &&
                (spec.target === undefined ||
                    configs.every(
                        config => reportRefusal(resolve(io.cwd, spec.target ?? ''), args.force, config) === undefined,
                    )),
        );
        if (outputs.length === 0) {
            return;
        }
        const root = gitRootOf(io.cwd) ?? io.cwd;
        const file = configFileOf(args, io, error, root);
        const place = file !== undefined && error instanceof ConfigError ? placeIn(error, file, root) : undefined;
        const hide = hiddenFolders([root], io);
        const report: Report = {
            tool: TOOL,
            findings: [],
            suppressedCount: 0,
            staleSuppressions: [],
            folderCount: 0,
            fileCount: 0,
            rules: CONFIG_RULES,
            hide,
            failure: {
                message: error instanceof Error ? error.message : String(error),
                ...(file !== undefined && { file }),
                ...place,
            },
        };
        emit(report, { ...args, outputs }, io);
    } catch {
        // The original error is what the user needs to see; this is an extra.
    }
}

/** The configuration files the run could have read: the one given, and the one found from here. */
function configPathsOf(args: Args, io: Io): (string | undefined)[] {
    const paths: (string | undefined)[] = [args.config === undefined ? undefined : resolve(io.cwd, args.config)];
    try {
        paths.push(findConfig(io.cwd)?.path);
    } catch {
        // Two configurations in one folder: the given one is enough to compare with.
    }
    return paths;
}

/** Where the first problem of the error is, when the file the failure names is the one it is about. */
function placeIn(error: ConfigError, file: string, root: string): { line: number; column: number } | undefined {
    const origin = isAbsolute(error.origin) ? relative(root, error.origin).split(sep).join('/') : undefined;
    return origin === file ? firstPlaceOf(error) : undefined;
}

/** The configuration file the failure is about, relative to the repository, when there is one. */
function configFileOf(args: Args, io: Io, error: unknown, root: string): string | undefined {
    const candidates: (string | undefined)[] = [
        error instanceof ConfigError && isAbsolute(error.origin) ? error.origin : undefined,
        args.config === undefined ? undefined : resolve(io.cwd, args.config),
    ];
    try {
        candidates.push(findConfig(io.cwd)?.path);
    } catch {
        // Two configurations in one folder: no single file to point at.
    }
    for (const candidate of candidates) {
        if (candidate === undefined || !existsSync(candidate)) {
            continue;
        }
        const path = relative(root, candidate).split(sep).join('/');
        if (!path.startsWith('..') && !isAbsolute(path)) {
            return path;
        }
    }
    return undefined;
}
