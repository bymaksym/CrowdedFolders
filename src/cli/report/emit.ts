import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    formatAzure,
    formatCheckstyle,
    formatGithub,
    formatGitlab,
    formatJson,
    formatMarkdown,
    formatSarif,
} from '../../core/report/machine.ts';
import type { Report } from '../../core/report/report.ts';
import { formatText } from '../../core/report/text.ts';
import type { Args, Format } from '../args.ts';
import { commandName, type Io, terminalWidth, wantsColor, wantsSymbols, writeFileAtomic } from '../io.ts';

/** The format `auto` stands for: what the CI the command runs in reads. */
export function resolveFormat(
    format: Format,
    env: Readonly<Record<string, string | undefined>>,
): Exclude<Format, 'auto'> {
    if (format !== 'auto') {
        return format;
    }
    if (env['GITHUB_ACTIONS'] === 'true') {
        return 'github';
    }
    if (env['TF_BUILD']?.toLowerCase() === 'true') {
        return 'azure';
    }
    // GitLab shows its Code Quality report from a file (-f gitlab=gl-code-quality-report.json); its
    // job log has no annotations, so a person reading it wants the text.
    return 'text';
}

/** What `emit` did, for the command to decide what else to say. */
export interface Emitted {
    /** Whether the text report went to standard output. */
    readonly textToStdout: boolean;
}

/**
 * Writes every report the command line asked for: each `-f` to its file, or to standard output (one
 * of them at most). A file named by `$GITHUB_STEP_SUMMARY` is appended to, because earlier steps
 * wrote to it and the runner reads it whole.
 */
export function emit(report: Report, args: Args, io: Io): Emitted {
    let textToStdout = false;
    for (const spec of args.outputs) {
        const format = resolveFormat(spec.format, io.env);
        const toStdout = spec.target === undefined;
        const text = render(report, format, args, {
            color: toStdout && wantsColor(args.color, io),
            hyperlinks: toStdout && io.stdoutIsTTY && wantsColor(args.color, io) && io.env['TERM'] !== 'dumb',
            // A report in a file is not for this terminal: its width and its symbols are not this one's.
            width: toStdout ? terminalWidth(io) : undefined,
            symbols: !toStdout || wantsSymbols(io),
            command: commandName(io),
        });
        if (toStdout) {
            io.write(text);
            textToStdout ||= format === 'text';
        } else if (isAppendTarget(spec.target, io)) {
            appendFileSync(resolve(io.cwd, spec.target), text, 'utf8');
        } else {
            writeFileAtomic(resolve(io.cwd, spec.target), text);
        }
    }
    return { textToStdout };
}

function isAppendTarget(target: string, io: Io): boolean {
    const summary = io.env['GITHUB_STEP_SUMMARY'];
    return summary !== undefined && summary !== '' && resolve(io.cwd, target) === resolve(io.cwd, summary);
}

function render(
    report: Report,
    format: Exclude<Format, 'auto'>,
    args: Args,
    text: { color: boolean; hyperlinks: boolean; width: number | undefined; symbols: boolean; command: string },
): string {
    switch (format) {
        case 'json': {
            return formatJson(report, { files: args.files });
        }
        case 'sarif': {
            return formatSarif(report);
        }
        case 'github': {
            return formatGithub(report, args.maxFindings === undefined ? {} : { maxPerKind: args.maxFindings });
        }
        case 'azure': {
            return formatAzure(report);
        }
        case 'gitlab': {
            return formatGitlab(report);
        }
        case 'checkstyle': {
            return formatCheckstyle(report);
        }
        case 'markdown': {
            return formatMarkdown(report, args.maxFindings === undefined ? {} : { maxFindings: args.maxFindings });
        }
        case 'text': {
            return formatText(report, {
                color: text.color,
                moves: args.moves,
                hyperlinks: text.hyperlinks,
                groupBy: args.groupBy,
                quiet: args.quiet,
                symbols: text.symbols,
                command: text.command,
                ...(text.width !== undefined && { width: text.width }),
            });
        }
    }
}
