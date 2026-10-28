import type { WhereResult } from './where.ts';
import { whereDetails, whereSummary } from './where.ts';

/**
 * Everything the kit for AI agents needs that is not the disk: the Claude Code hook's input and answer,
 * the `.claude/settings.json` that registers it, the block of `AGENTS.md`, and the diff `--dry-run`
 * prints. Pure, so each part is tested with strings.
 */

/** The tools whose new files the hook looks at. `MultiEdit` is older Claude Code's; the current docs name `Write` and `Edit`. */
export const HOOK_TOOLS = ['Write', 'Edit', 'MultiEdit'] as const;

/** What `init --agents` writes as the command: through `npx` without installing, so it uses the project's own copy. */
export const HOOK_COMMAND = 'npx --no-install crowded-folders hook claude';

/** Seconds Claude Code waits for the hook before it goes on without it (the unit is seconds). */
export const HOOK_TIMEOUT = 10;

/** What the hook reads from Claude Code's JSON on standard input, once it is known to be about a file to add. */
export interface HookRequest {
    readonly tool: string;
    /** As Claude Code sent it: absolute, or relative to `cwd`. */
    readonly file: string;
    /** The folder Claude Code runs in; `undefined` when the JSON does not say. */
    readonly cwd: string | undefined;
}

/**
 * Reads the `PreToolUse` JSON Claude Code sends (`hook_event_name`, `tool_name`, `tool_input.file_path`,
 * `cwd`). Anything else, or text that is not JSON, is `undefined`: the hook has nothing to say.
 */
export function readHookRequest(text: string): HookRequest | undefined {
    let input: unknown;
    try {
        input = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof input !== 'object' || input === null) {
        return undefined;
    }
    const { hook_event_name: event, tool_name: tool, tool_input: toolInput, cwd } = input as Record<string, unknown>;
    if ((event !== undefined && event !== 'PreToolUse') || typeof tool !== 'string') {
        return undefined;
    }
    if (!(HOOK_TOOLS as readonly string[]).includes(tool) || typeof toolInput !== 'object' || toolInput === null) {
        return undefined;
    }
    const file = (toolInput as Record<string, unknown>)['file_path'];
    if (typeof file !== 'string' || file === '') {
        return undefined;
    }
    return { tool, file, cwd: typeof cwd === 'string' && cwd !== '' ? cwd : undefined };
}

/** The JSON Claude Code reads from the hook's standard output. It never carries a permission decision: it warns, it does not block. */
export interface HookResponse {
    readonly systemMessage?: string;
    readonly hookSpecificOutput: {
        readonly hookEventName: 'PreToolUse';
        /** Added to Claude's context next to the tool result: how the agent hears it. */
        readonly additionalContext: string;
    };
}

/**
 * What the hook says about the files it was asked about: a warning (for the agent, and a line for the
 * person) when one would make its folder worse, a hint (for the agent only) when an existing folder fits
 * the name, and `undefined` — print nothing — otherwise. Never a `permissionDecision`: the tool call goes
 * on as it would have, through the normal permission flow.
 */
export function hookResponse(results: readonly WhereResult[]): HookResponse | undefined {
    const worse = results.filter(result => result.effect === 'creates' || result.effect === 'worsens');
    const fits = results.filter(
        result => result.effect === 'neutral' && result.candidates.some(candidate => candidate.kind === 'folder'),
    );
    const mentioned = worse.length > 0 ? worse : fits;
    if (mentioned.length === 0) {
        return undefined;
    }
    const lines = mentioned.flatMap(result => [
        `crowded-folders: ${result.path}: ${whereSummary(result)}`,
        ...whereDetails(result).map(line => `  ${line}`),
    ]);
    const advice =
        worse.length > 0
            ? 'This is a warning, nothing was blocked. Prefer a folder that fits (above), or say why the file belongs here. Do not raise a limit or add a suppression to silence it.'
            : 'This is a hint, nothing was blocked: an existing folder fits the name.';
    return {
        ...(worse.length > 0 && {
            systemMessage: `crowded-folders: ${worse.map(result => `${result.path}: ${whereSummary(result)}`).join('; ')}`,
        }),
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `${lines.join('\n')}\n${advice}` },
    };
}

/** Raised for a file `init --agents` cannot merge into without losing something: say so, change nothing. */
export class AgentsKitError extends Error {
    override readonly name = 'AgentsKitError';
}

/** The result of merging into a file: its new text, and whether that differs from the old. */
export interface Merged {
    readonly text: string;
    readonly changed: boolean;
}

const HOOK_MENTION = /crowded-folders\s+hook\s+claude/u;

/** Whether a command registered under `hooks` is this tool's hook, however the person wrote the launcher. */
function isOurs(entry: unknown): boolean {
    if (typeof entry !== 'object' || entry === null) {
        return false;
    }
    const hooks = (entry as Record<string, unknown>)['hooks'];
    return (
        Array.isArray(hooks) &&
        hooks.some(hook => {
            const command =
                typeof hook === 'object' && hook !== null ? (hook as Record<string, unknown>)['command'] : '';
            return typeof command === 'string' && HOOK_MENTION.test(command);
        })
    );
}

/**
 * Adds the hook to the text of `.claude/settings.json` (`undefined`: no file yet), leaving every other key and every other
 * hook as they are, with the indentation the file had. Merging twice is merging once: when the hook is there already (written
 * by this or by a person, in any group), the text comes back unchanged.
 */
export function mergeClaudeSettings(existing: string | undefined, command: string = HOOK_COMMAND): Merged {
    let settings: Record<string, unknown> = {};
    if (existing !== undefined && existing.trim() !== '') {
        let parsed: unknown;
        try {
            parsed = JSON.parse(existing);
        } catch (error) {
            throw new AgentsKitError(
                `.claude/settings.json is not valid JSON (${error instanceof Error ? error.message : String(error)}); comments are not allowed in it either. Fix it, or add the hook by hand.`,
            );
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new AgentsKitError('.claude/settings.json is not a JSON object, so no hook can be added to it.');
        }
        settings = parsed as Record<string, unknown>;
    }
    const hooks: unknown = settings['hooks'] ?? {};
    if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) {
        throw new AgentsKitError('"hooks" in .claude/settings.json is not an object, so no hook can be added to it.');
    }
    const before: unknown = (hooks as Record<string, unknown>)['PreToolUse'] ?? [];
    if (!Array.isArray(before)) {
        throw new AgentsKitError(
            '"hooks.PreToolUse" in .claude/settings.json is not a list, so no hook can be added to it.',
        );
    }
    if (before.some(entry => isOurs(entry))) {
        return { text: existing ?? '', changed: false };
    }
    const entry = { matcher: HOOK_TOOLS.join('|'), hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT }] };
    const merged = { ...settings, hooks: { ...hooks, PreToolUse: [...(before as unknown[]), entry] } };
    const indent = indentOf(existing);
    const eol = existing?.includes('\r\n') === true ? '\r\n' : '\n';
    return { text: `${JSON.stringify(merged, undefined, indent).split('\n').join(eol)}${eol}`, changed: true };
}

/** The indentation of a JSON file: what its first property uses; two spaces (Claude Code's own) when it cannot tell. */
function indentOf(text: string | undefined): string {
    return (text === undefined ? undefined : /^\{\r?\n([ \t]+)"/u.exec(text)?.[1]) ?? '  ';
}

export const AGENTS_START = '<!-- crowded-folders:start -->';
export const AGENTS_END = '<!-- crowded-folders:end -->';

/** The block `init --agents` puts in `AGENTS.md`, between its markers: short, because every agent reads it every time. */
export const AGENTS_BLOCK = `${AGENTS_START}
## Folder structure (crowded-folders)

Do not let a folder become a drawer. Before you add a file:

- \`npx crowded-folders where <new/path.ts>\` says OK, WORSE or CREATES a problem, and which existing folder fits the name.
- \`npx crowded-folders\` checks the whole repository; run it before you say you are done (exit 1 means errors).
- A folder that is already crowded: \`npx crowded-folders explain <folder> --prompt\` writes the reorganisation task.
- Do not raise a limit or add a suppression to silence it without saying why.
${AGENTS_END}`;

/**
 * Puts the block in the text of `AGENTS.md`: created when there is none, appended after a blank line when
 * the file has no markers, replaced between the markers when it has them (so running it again updates the
 * block and touches nothing else). Markers that cannot be matched are an error, not a guess.
 */
export function mergeAgentsMd(existing: string | undefined, block: string = AGENTS_BLOCK): Merged {
    if (existing === undefined || existing.trim() === '') {
        return { text: `${block}\n`, changed: true };
    }
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';
    const written = block.split('\n').join(eol);
    const start = existing.indexOf(AGENTS_START);
    const end = existing.indexOf(AGENTS_END);
    if (start === -1 && end === -1) {
        const separator = existing.endsWith('\n') ? eol : `${eol}${eol}`;
        return { text: `${existing}${separator}${written}${eol}`, changed: true };
    }
    if (start === -1 || end === -1 || end < start || existing.includes(AGENTS_START, start + 1)) {
        throw new AgentsKitError(
            `AGENTS.md has ${AGENTS_START} and ${AGENTS_END} but not once each and in that order: fix them, or delete both, and run it again.`,
        );
    }
    const text = `${existing.slice(0, start)}${written}${existing.slice(end + AGENTS_END.length)}`;
    return { text, changed: text !== existing };
}

/**
 * A unified diff of one file, as `git diff` shows it, for `--dry-run`. One hunk from the first line that
 * differs to the last, with three lines of context: what these merges change is always one place.
 */
export function unifiedDiff(path: string, before: string | undefined, after: string): string {
    const old = before === undefined ? [] : lines(before);
    const next = lines(after);
    let head = 0;
    while (head < old.length && head < next.length && old[head] === next[head]) {
        head++;
    }
    let tail = 0;
    while (tail < old.length - head && tail < next.length - head && old.at(-1 - tail) === next.at(-1 - tail)) {
        tail++;
    }
    const context = 3;
    const from = Math.max(0, head - context);
    const oldEnd = Math.min(old.length, old.length - tail + context);
    const nextEnd = Math.min(next.length, next.length - tail + context);
    const body = [
        ...old.slice(from, head).map(line => ` ${line}`),
        ...old.slice(head, old.length - tail).map(line => `-${line}`),
        ...next.slice(head, next.length - tail).map(line => `+${line}`),
        ...old.slice(old.length - tail, oldEnd).map(line => ` ${line}`),
    ];
    const header = [
        `--- ${before === undefined ? '/dev/null' : `a/${path}`}`,
        `+++ b/${path}`,
        `@@ -${old.length === 0 ? 0 : from + 1},${oldEnd - from} +${next.length === 0 ? 0 : from + 1},${nextEnd - from} @@`,
    ];
    return `${[...header, ...body].join('\n')}\n`;
}

function lines(text: string): string[] {
    const split = text.replaceAll('\r\n', '\n').split('\n');
    return split.at(-1) === '' ? split.slice(0, -1) : split;
}
