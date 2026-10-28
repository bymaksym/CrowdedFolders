import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { realPath } from '../../node/config-file.ts';
import { isTrackedByGit } from '../../node/files.ts';
import { type Args, UsageError } from '../args.ts';
import type { Session } from '../session.ts';

/**
 * Where each report is written (`-o`, `-f format=file`), checked before anything runs: a folder is a
 * usage error, not a crash, and a file the repository keeps (the configuration, a tracked source
 * file) is not replaced by a report unless `--force` says so. The same order as `args.outputs`, each
 * absolute, `undefined` for standard output.
 */
export function outputPathsOf(args: Args, session: Session): (string | undefined)[] {
    return args.outputs.map(({ target, option }) => {
        if (target === undefined) {
            return;
        }
        return reportPathOf(option, target, args, session);
    });
}

function reportPathOf(option: string, target: string, args: Args, session: Session): string {
    const path = resolve(session.cwd, target);
    const refusal = reportRefusal(path, args.force, session.configPath);
    if (refusal === 'folder') {
        throw new UsageError(
            `${option}: ${path} is a folder; give the file to write in it, such as ${join(target, 'crowded-folders.sarif')}`,
        );
    }
    if (refusal === 'configuration') {
        throw new UsageError(
            `${option} is the configuration: the report would replace it. Pass --force to write it anyway.`,
        );
    }
    if (refusal === 'tracked') {
        throw new UsageError(
            `${option}: git tracks ${path}, and the report would replace it. Write it elsewhere, or pass --force.`,
        );
    }
    return path;
}

/**
 * Why a report must not be written at `path`: it is a folder, or (without `--force`) the
 * configuration or a file git tracks; `undefined` when it can be. Also asked by the reports a failed
 * run still writes, so that a refused file is not written over on the way out.
 */
export function reportRefusal(
    path: string,
    force: boolean,
    configPath: string | undefined,
): 'configuration' | 'folder' | 'tracked' | undefined {
    if (!existsSync(path)) {
        return undefined;
    }
    if (statSync(path).isDirectory()) {
        return 'folder';
    }
    if (force) {
        return undefined;
    }
    if (configPath !== undefined && existsSync(configPath) && realPath(path) === realPath(configPath)) {
        return 'configuration';
    }
    return isTrackedByGit(path) ? 'tracked' : undefined;
}
