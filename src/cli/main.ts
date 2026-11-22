import { AgentsKitError } from '../core/agents/kit.ts';
import { FileListError } from '../core/paths/input.ts';
import { attributeRuleError, RuleError } from '../core/rules/guard.ts';
import { describeConfigError } from '../node/config/error.ts';
import { realPath } from '../node/config/real-path.ts';
import { GitError } from '../node/files.ts';
import { ConfigError } from '../node/load-config.ts';
import { type Args, parseCommandLine, UsageError } from './args.ts';
import { initAgents } from './commands/agents.ts';
import { check } from './commands/check.ts';
import { explain } from './commands/explain.ts';
import { history } from './commands/history.ts';
import { hook } from './commands/hook.ts';
import { init } from './commands/init.ts';
import { listPresets, listRules, printConfig } from './commands/lists.ts';
import { overrides } from './commands/overrides.ts';
import { where } from './commands/where.ts';
import { COMMAND_HELP, HELP } from './help.ts';
import { type Io, processIo, WriteError } from './io.ts';
import { writeFailureReports } from './report/failure.ts';
import { openSession, type Session } from './session.ts';
import { TOOL } from './tool.ts';

/** Runs the command and returns its exit code: 0 clean, 1 problems, 2 the input was wrong or it broke. */
export async function run(argv: readonly string[], given: Io = processIo()): Promise<number> {
    // The one place the folder the command was typed in is read: from here on it is its real path, the
    // form every other path of the run is compared with (a Windows short name, a junction, macOS's /var).
    const io: Io = { ...given, cwd: realPath(given.cwd) };
    let args: Args | undefined;
    let session: Session | undefined;
    try {
        args = parseCommandLine(argv);
        if (args.help) {
            io.write(
                args.commandGiven
                    ? `${COMMAND_HELP[args.command]}
`
                    : HELP,
            );
            return 0;
        }
        if (args.version) {
            io.write(`${TOOL.version}\n`);
            return 0;
        }
        if (args.command === 'init' && args.agents) {
            return initAgents(args, io);
        }
        if (args.command === 'hook') {
            return await hook(args, io);
        }
        if (args.command === 'presets') {
            return await listPresets(args, io);
        }
        if (args.command === 'rules') {
            return await listRules(args, io);
        }
        session = await openSession(args, io);
        for (const notice of session.notices) {
            io.error(`crowded-folders: ${notice}
`);
        }
        switch (args.command) {
            case 'init': {
                return await init(args, io, session);
            }
            case 'explain': {
                return await explain(args, io, session);
            }
            case 'where': {
                return where(args, io, session);
            }
            case 'overrides': {
                return overrides(args, io, session);
            }
            case 'history': {
                return history(args, io, session);
            }
            case 'tree': {
                // It shows the folders and does not judge them: the exit code is for `check`.
                await check(args, io, session);
                return 0;
            }
            case 'print-config': {
                return await printConfig(args, io, session);
            }
            default: {
                return await check(args, io, session);
            }
        }
    } catch (error_) {
        // A plugin's rule that broke is the plugin's to fix: its message says whose it is.
        const error = error_ instanceof RuleError ? attributeRuleError(error_, session?.loaded.plugins ?? []) : error_;
        if (args) {
            writeFailureReports(args, io, error);
        }
        if (error instanceof UsageError) {
            io.error(`crowded-folders: ${error.message}\nRun crowded-folders --help for the options.\n`);
            return 2;
        }
        if (error instanceof ConfigError) {
            io.error(`crowded-folders: ${describeConfigError(error, io.cwd)}\n`);
            return 2;
        }
        // What the person who ran it caused: the files git lists, a plugin's rule, a file it cannot write.
        // A built-in rule that throws is our bug, and falls through to say so.
        if (
            error instanceof GitError ||
            error instanceof FileListError ||
            (error instanceof RuleError && error.rule.includes('/')) ||
            error instanceof WriteError ||
            error instanceof AgentsKitError
        ) {
            io.error(`crowded-folders: ${error.message}\n`);
            return 2;
        }
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        io.error(`crowded-folders broke — this is a bug, please report it at ${TOOL.url}/issues\n${message}\n`);
        return 2;
    }
}
