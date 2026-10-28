import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, relative } from 'node:path';

import { offsetOfPath, positionOf } from '../core/config/locate.ts';
import type { ConfigError } from '../core/config/validate.ts';

/** The key of a `package.json` that holds the configuration. */
export const PACKAGE_KEY = 'crowded-folders';

/** A path for a message: from where the command was typed, unless that is longer than the whole path. */
export function shownPath(cwd: string, path: string): string {
    const relativePath = relative(cwd, path).replaceAll('\\', '/');
    if (relativePath === '') {
        return '.';
    }
    return isAbsolute(relativePath) || relativePath.length >= path.length ? path : relativePath;
}

/**
 * The error as a person at a terminal reads it: the file from where the command was typed, not from the
 * top of the disk, and each problem with `file:line:col` where the text says where it is, which an
 * editor or a terminal turns into a link. The file is read again here, only to say where.
 */
export function describeConfigError(error: ConfigError, cwd: string): string {
    const file = isAbsolute(error.origin) && existsSync(error.origin) ? error.origin : undefined;
    const name = file === undefined ? error.origin : shownPath(cwd, file);
    const text = file === undefined ? undefined : readOrUndefined(file);
    const lines = error.problems.map(problem => {
        const place = problem.line === undefined ? placeOf(text, file, problem.at) : problem;
        const where = place === undefined ? '' : `${name}:${place.line}:${place.column}  `;
        const what = problem.at === '' || problem.at.startsWith('(') ? '' : `${problem.at}: `;
        return `  ${where}${what}${problem.message}`;
    });
    const count = error.problems.length === 1 ? 'a problem' : `${error.problems.length} problems`;
    return `${name} has ${count}:\n${lines.join('\n')}`;
}

function placeOf(
    text: string | undefined,
    file: string | undefined,
    at: string,
): { readonly line: number; readonly column: number } | undefined {
    if (text === undefined || file === undefined || !['.json', '.jsonc'].includes(extname(file))) {
        return undefined;
    }
    const under = basename(file) === 'package.json' ? [PACKAGE_KEY] : [];
    const offset = offsetOfPath(text, at, under);
    return offset === undefined ? undefined : positionOf(text, offset);
}

function readOrUndefined(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
}
