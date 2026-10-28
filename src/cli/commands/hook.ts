import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { hookResponse, readHookRequest } from '../../core/agents/kit.ts';
import { type Args, parseCommandLine } from '../args.ts';
import type { Io } from '../io.ts';
import { openSession } from '../session.ts';
import { whereResults } from './where.ts';

/**
 * `crowded-folders hook claude`: a Claude Code `PreToolUse` hook. Claude Code writes the tool call as JSON
 * to standard input; when it is a new file that would make its folder worse (or an existing folder fits its
 * name) this prints the JSON Claude Code reads back, with the warning for the agent and a line for the person.
 *
 * It never blocks: no `permissionDecision`, exit 0 always. Whatever goes wrong - JSON of another shape, no
 * git, a configuration that does not load - it says nothing on standard output, because a tool that gets in
 * the way of every write is a tool that is turned off. The reason goes to standard error, which Claude Code
 * keeps in its debug log.
 */
export async function hook(args: Args, io: Io): Promise<number> {
    try {
        const request = readHookRequest(await io.readStdin());
        if (request === undefined) {
            return 0;
        }
        const cwd = request.cwd ?? io.cwd;
        // An Edit of a file that is there adds no file: nothing to ask git for.
        if (existsSync(resolve(cwd, request.file))) {
            return 0;
        }
        const passed = [
            ...(args.config === undefined ? [] : ['--config', args.config]),
            ...(args.root === undefined ? [] : ['--root', args.root]),
            ...(args.code ? [] : ['--no-code']),
        ];
        const asked = parseCommandLine(['where', ...passed, '--', request.file]);
        const where: Io = { ...io, cwd };
        const session = await openSession(asked, where);
        const response = hookResponse(whereResults(asked.paths, session, cwd));
        if (response !== undefined) {
            io.write(`${JSON.stringify(response)}\n`);
        }
    } catch (error) {
        io.error(`crowded-folders hook: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 0;
}
