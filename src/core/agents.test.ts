import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    AGENTS_BLOCK,
    AGENTS_END,
    AGENTS_START,
    AgentsKitError,
    HOOK_COMMAND,
    hookResponse,
    mergeAgentsMd,
    mergeClaudeSettings,
    readHookRequest,
    unifiedDiff,
} from './agents.ts';
import type { WhereResult } from './where.ts';

/** The JSON Claude Code sends a PreToolUse hook for Write (docs: code.claude.com/docs/en/hooks). */
const WRITE_INPUT = {
    session_id: 'abc123',
    transcript_path: '/home/user/.claude/projects/p/transcript.jsonl',
    cwd: '/home/user/project',
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: '/home/user/project/core/enums/foo-bar.enum.ts', content: 'export enum Foo {}' },
    tool_use_id: 'toolu_01ABC123',
};

const worse: WhereResult = {
    path: 'core/enums/foo-bar.enum.ts',
    folder: 'core/enums',
    effect: 'worsens',
    changes: [
        {
            change: 'worse',
            rule: 'max-files',
            severity: 'error',
            folder: 'core/enums',
            key: undefined,
            before: 14,
            after: 15,
            limit: 10,
            message: '15 files, over the limit of 10.',
            moves: [],
        },
    ],
    candidates: [],
};
const fits: WhereResult = {
    path: 'core/layout/navbar-mobile.component.ts',
    folder: 'core/layout',
    effect: 'neutral',
    changes: [],
    candidates: [{ folder: 'core/layout/navbar', kind: 'folder', reason: 'it exists' }],
};
const plain: WhereResult = { path: 'a/b.ts', folder: 'a', effect: 'neutral', changes: [], candidates: [] };

describe('the Claude Code hook JSON', () => {
    it('reads the PreToolUse input of Write, Edit and MultiEdit', () => {
        assert.deepEqual(readHookRequest(JSON.stringify(WRITE_INPUT)), {
            tool: 'Write',
            file: '/home/user/project/core/enums/foo-bar.enum.ts',
            cwd: '/home/user/project',
        });
        for (const tool of ['Edit', 'MultiEdit']) {
            const input = { ...WRITE_INPUT, tool_name: tool, tool_input: { file_path: 'a.ts', old_string: 'a' } };
            assert.equal(readHookRequest(JSON.stringify(input))?.tool, tool);
        }
        assert.equal(readHookRequest(JSON.stringify({ ...WRITE_INPUT, cwd: undefined }))?.cwd, undefined);
    });

    it('has nothing to say about another event, another tool, or text that is not the input', () => {
        const other = (change: object): string => JSON.stringify({ ...WRITE_INPUT, ...change });
        assert.equal(readHookRequest(other({ hook_event_name: 'PostToolUse' })), undefined);
        assert.equal(readHookRequest(other({ tool_name: 'Bash', tool_input: { command: 'ls' } })), undefined);
        assert.equal(readHookRequest(other({ tool_input: { content: 'no path' } })), undefined);
        assert.equal(readHookRequest(other({ tool_input: { file_path: 3 } })), undefined);
        assert.equal(readHookRequest(other({ tool_input: null })), undefined);
        assert.equal(readHookRequest('not json'), undefined);
        assert.equal(readHookRequest('[]'), undefined);
        assert.equal(readHookRequest(''), undefined);
    });

    it('warns with additionalContext for the agent and systemMessage for the person, and never decides', () => {
        const response = hookResponse([worse]);
        assert.deepEqual(
            Object.keys(response ?? {}).toSorted((a, b) => a.localeCompare(b)),
            ['hookSpecificOutput', 'systemMessage'],
        );
        assert.deepEqual(
            Object.keys(response?.hookSpecificOutput ?? {}).toSorted((a, b) => a.localeCompare(b)),
            ['additionalContext', 'hookEventName'],
        );
        assert.equal(response?.hookSpecificOutput.hookEventName, 'PreToolUse');
        assert.match(
            response?.systemMessage ?? '',
            /^crowded-folders: core\/enums\/foo-bar\.enum\.ts: WORSE max-files 14/u,
        );
        const context = response?.hookSpecificOutput.additionalContext ?? '';
        assert.match(context, /WORSE max-files 14\u{2192}15 \(limit 10\)/u);
        assert.match(context, /nothing was blocked/u);
        // Nothing that would allow, deny or stop: Claude Code goes on with the normal permission flow.
        const text = JSON.stringify(response);
        assert.doesNotMatch(text, /permissionDecision|"continue"|"decision"/u);
        assert.deepEqual(JSON.parse(text), response);
    });

    it('only hints, to the agent alone, when an existing folder fits and nothing is worse', () => {
        const response = hookResponse([fits, plain]);
        assert.equal(response?.systemMessage, undefined);
        assert.match(response?.hookSpecificOutput.additionalContext ?? '', /core\/layout\/navbar\/ exists/u);
        assert.match(response?.hookSpecificOutput.additionalContext ?? '', /hint, nothing was blocked/u);
    });

    it('says nothing when there is nothing to say', () => {
        assert.equal(hookResponse([plain]), undefined);
        assert.equal(hookResponse([{ ...plain, effect: 'exists' }]), undefined);
        assert.equal(hookResponse([]), undefined);
    });
});

describe('.claude/settings.json', () => {
    it('creates the file with the hook, with the matcher of the tools and the timeout in seconds', () => {
        const { text, changed } = mergeClaudeSettings(undefined);
        assert.equal(changed, true);
        assert.deepEqual(JSON.parse(text), {
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'Write|Edit|MultiEdit',
                        hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }],
                    },
                ],
            },
        });
        assert.ok(text.endsWith('}\n'));
    });

    it('keeps every other setting and hook, in their order, and the indentation of the file', () => {
        const mine = {
            permissions: { allow: ['Bash(npm test)'] },
            hooks: {
                PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }],
                Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
            },
            model: 'opus',
        };
        const before = `${JSON.stringify(mine, undefined, 4)}\n`;
        const { text } = mergeClaudeSettings(before);
        const after = JSON.parse(text) as typeof mine & { hooks: { PreToolUse: unknown[] } };
        assert.deepEqual(Object.keys(after), ['permissions', 'hooks', 'model']);
        assert.deepEqual(Object.keys(after.hooks), ['PreToolUse', 'Stop']);
        assert.deepEqual(after.hooks.PreToolUse[0], mine.hooks.PreToolUse[0]);
        assert.equal(after.hooks.PreToolUse.length, 2);
        assert.deepEqual(after.hooks.Stop, mine.hooks.Stop);
        assert.match(text, /^\{\n {4}"permissions"/u);
    });

    it('is idempotent: merging again, or over a hook a person wrote by hand, changes nothing', () => {
        const once = mergeClaudeSettings('{ "model": "opus" }');
        const twice = mergeClaudeSettings(once.text);
        assert.equal(twice.changed, false);
        assert.equal(twice.text, once.text);
        const byHand =
            '{"hooks":{"PreToolUse":[{"matcher":"Write","hooks":[{"type":"command","command":"pnpm exec crowded-folders hook claude"}]}]}}';
        const kept = mergeClaudeSettings(byHand);
        assert.deepEqual([kept.changed, kept.text], [false, byHand]);
    });

    it('keeps Windows line endings', () => {
        const { text } = mergeClaudeSettings('{\r\n  "model": "opus"\r\n}\r\n');
        assert.ok(text.includes('\r\n'));
        assert.equal(text.replaceAll('\r\n', '').includes('\n'), false);
    });

    it('stops, changing nothing, at a file it could not merge into without losing something', () => {
        for (const bad of ['{ "model": }', '// comment\n{}', '[]', '{"hooks": []}', '{"hooks": {"PreToolUse": {}}}']) {
            assert.throws(() => mergeClaudeSettings(bad), AgentsKitError, bad);
        }
    });
});

describe('AGENTS.md', () => {
    it('creates the file with the block, short enough to be read every time', () => {
        const { text, changed } = mergeAgentsMd(undefined);
        assert.deepEqual([text, changed], [`${AGENTS_BLOCK}\n`, true]);
        assert.ok(AGENTS_BLOCK.split('\n').length <= 12);
        assert.equal(mergeAgentsMd('  \n').text, text);
    });

    it('appends after the text there, with one blank line, whether or not it ends in a newline', () => {
        const withNewline = mergeAgentsMd('# Agents\n\nUse pnpm.\n').text;
        assert.equal(withNewline, `# Agents\n\nUse pnpm.\n\n${AGENTS_BLOCK}\n`);
        const without = mergeAgentsMd('# Agents').text;
        assert.equal(without, `# Agents\n\n${AGENTS_BLOCK}\n`);
    });

    it('replaces what is between its markers and touches nothing else, so running it again changes nothing', () => {
        const stale = `# Agents\n\n${AGENTS_START}\nold text\n${AGENTS_END}\n\n## After\nmine\n`;
        const updated = mergeAgentsMd(stale);
        assert.equal(updated.changed, true);
        assert.equal(updated.text, `# Agents\n\n${AGENTS_BLOCK}\n\n## After\nmine\n`);
        const again = mergeAgentsMd(updated.text);
        assert.deepEqual([again.changed, again.text], [false, updated.text]);
        const appended = mergeAgentsMd('# Agents\n');
        assert.equal(mergeAgentsMd(appended.text).changed, false);
    });

    it('keeps CRLF files in CRLF', () => {
        const { text } = mergeAgentsMd('# Agents\r\n');
        assert.equal(text.replaceAll('\r\n', '').includes('\n'), false);
        assert.equal(mergeAgentsMd(text).changed, false);
    });

    it('refuses markers that do not pair up', () => {
        for (const bad of [
            `${AGENTS_START}\nx`,
            `${AGENTS_END}\n${AGENTS_START}`,
            `${AGENTS_START}${AGENTS_START}${AGENTS_END}`,
        ]) {
            assert.throws(() => mergeAgentsMd(bad), AgentsKitError);
        }
    });
});

describe('the diff of --dry-run', () => {
    it('shows an added file against /dev/null, and a change with its context', () => {
        assert.equal(
            unifiedDiff('AGENTS.md', undefined, 'a\nb\n'),
            '--- /dev/null\n+++ b/AGENTS.md\n@@ -0,0 +1,2 @@\n+a\n+b\n',
        );
        const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
        const after = 'one\ntwo\nthree\nfour\nfour and a half\nfive\nsix\nseven\n';
        assert.equal(
            unifiedDiff('x.txt', before, after),
            '--- a/x.txt\n+++ b/x.txt\n@@ -2,6 +2,7 @@\n two\n three\n four\n+four and a half\n five\n six\n seven\n',
        );
    });

    it('shows the lines it removes', () => {
        assert.equal(unifiedDiff('x', 'a\nb\nc\n', 'a\nc\n'), '--- a/x\n+++ b/x\n@@ -1,3 +1,2 @@\n a\n-b\n c\n');
    });
});
