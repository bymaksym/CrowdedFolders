import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { whereDetails, type WhereResult, whereSummary, whereWouldGo } from '../../core/agents/where.ts';
import { asciiProse } from '../../core/report/ascii.ts';
import { isIgnoredByGit } from '../../node/files.ts';
import type { Args } from '../args.ts';
import { type Io, wantsSymbols } from '../io.ts';
import { newFilesFromPaths } from '../new-files.ts';
import type { Session } from '../session.ts';

/** What `where` and the agents' hook ask the repository: the answer for each new path (relative to where it was typed). */
export function whereResults(paths: readonly string[], session: Session, cwd: string): WhereResult[] {
    const files = session.files;
    const { config, rules } = session.loaded;
    return newFilesFromPaths(paths, session, cwd).map(path => {
        const result = whereWouldGo({ files, config, rules, path });
        if (result.effect === 'exists') {
            return result;
        }
        // Written but not listed: a file .gitignore hides, or one a tracked-only list leaves out.
        if (existsSync(join(session.base, path))) {
            return { ...result, effect: 'exists', changes: [], candidates: [] } satisfies WhereResult;
        }
        const hidden =
            result.effect !== 'neutral' && session.fileSource === 'git' && isIgnoredByGit(session.base, path);
        return hidden
            ? ({
                  path: result.path,
                  folder: result.folder,
                  effect: 'unchecked',
                  note: 'git ignores it (.gitignore)',
                  changes: [],
                  candidates: [],
              } satisfies WhereResult)
            : result;
    });
}

/** Whether an answer is one a person would want to stop for: the file makes its folder worse. */
export function isWorse(result: WhereResult): boolean {
    return result.effect === 'creates' || result.effect === 'worsens';
}

/**
 * `crowded-folders where <new-path>...`: for each path, whether a file added there creates, worsens or
 * leaves as it is a problem in its folder, and where else it could go. Each path is asked on its own,
 * against the files that exist. Nothing is created. Exit 0, or 1 with `--fail-on worse` when one is worse.
 */
export function where(args: Args, io: Io, session: Session): number {
    const results = whereResults(args.paths, session, io.cwd);
    if (args.format === 'json') {
        io.write(`${JSON.stringify({ version: 1, results }, undefined, 2)}\n`);
    } else {
        const say = wantsSymbols(io) ? (text: string): string => text : asciiProse;
        const blocks = results.map(result =>
            [result.path, ...[whereSummary(result), ...whereDetails(result)].map(line => `  ${line}`)].join('\n'),
        );
        io.write(say(`${blocks.join('\n\n')}\n`));
    }
    return args.failOn === 'worse' && results.some(result => isWorse(result)) ? 1 : 0;
}
