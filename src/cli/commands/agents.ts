import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { mergeAgentsMd, mergeClaudeSettings, type Merged, unifiedDiff } from '../../core/agents.ts';
import { gitRootOf, realPath } from '../../node/config/file.ts';
import type { Args } from '../args.ts';
import { type Io, writeFileAtomic } from '../io.ts';

/** One file the kit changes: where it is, what it holds, and what it would hold. */
interface Change {
    readonly path: string;
    readonly shown: string;
    readonly before: string | undefined;
    readonly merged: Merged;
    readonly what: string;
}

/**
 * `crowded-folders init --agents [--dry-run]`: registers the Claude Code hook in `.claude/settings.json`
 * and puts a short block in `AGENTS.md`. Both are merged, never overwritten: other hooks and the rest of
 * the file stay as they are, and running it twice changes nothing. With `--dry-run` it prints the diff of
 * what it would write and writes nothing. It writes no configuration: `init` does that.
 */
export function initAgents(args: Args, io: Io): number {
    const cwd = realPath(io.cwd);
    const root = args.root === undefined ? (gitRootOf(cwd) ?? cwd) : realPath(resolve(cwd, args.root));
    const settings = join(root, '.claude', 'settings.json');
    const notes = join(root, 'AGENTS.md');
    const read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

    const changes: Change[] = [];
    for (const [path, what, merge] of [
        [settings, 'the PreToolUse hook (crowded-folders hook claude)', mergeClaudeSettings],
        [notes, 'the crowded-folders block', mergeAgentsMd],
    ] as const) {
        const before = read(path);
        const merged = merge(before);
        changes.push({ path, shown: relative(cwd, path) || path, before, merged, what });
    }

    const lines: string[] = [];
    for (const change of changes) {
        const { path, shown, before, merged, what } = change;
        if (!merged.changed) {
            lines.push(`${shown}: has ${what} already; unchanged.`);
        } else if (args.dryRun) {
            lines.push(unifiedDiff(relative(root, path).replaceAll('\\', '/'), before, merged.text).trimEnd());
        } else {
            writeFileAtomic(path, merged.text);
            lines.push(`${shown}: ${before === undefined ? 'created' : 'updated'} with ${what}.`);
        }
    }
    if (args.dryRun) {
        lines.push('', 'Dry run: nothing was written.');
    }
    if (!existsSync(join(root, 'node_modules', 'crowded-folders'))) {
        lines.push(
            '',
            'crowded-folders is not installed in this project, and the hook runs `npx --no-install crowded-folders`:',
            'add it (npm install --save-dev crowded-folders) or the hook will find nothing to run.',
        );
    }
    io.write(`${lines.join('\n')}\n`);
    return 0;
}
