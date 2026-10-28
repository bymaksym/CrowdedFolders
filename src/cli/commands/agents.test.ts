import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { AGENTS_END, AGENTS_START } from '../../core/agents/kit.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const CONFIG = JSON.stringify({ rules: { 'max-files': ['error', { max: 3 }] } });

function drawer(): string {
    return repository({
        'crowded-folders.config.json': CONFIG,
        'core/enums/a.enum.ts': '',
        'core/enums/b.enum.ts': '',
        'core/enums/c.enum.ts': '',
        'core/layout/navbar/navbar.component.ts': '',
    });
}

function hookInput(root: string, tool: string, file: string): string {
    return JSON.stringify({
        session_id: 's',
        transcript_path: join(root, 't.jsonl'),
        cwd: root,
        permission_mode: 'default',
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: { file_path: join(root, file), content: '' },
        tool_use_id: 'toolu_1',
    });
}

describe('crowded-folders hook claude', () => {
    it('answers a Write of a file that would make its folder worse with the JSON Claude Code reads', async () => {
        const root = drawer();
        const ran = await cli(root, ['hook', 'claude'], {}, hookInput(root, 'Write', 'core/enums/foo-bar.enum.ts'));
        assert.equal(ran.code, 0, ran.err);
        const response = JSON.parse(ran.out) as {
            systemMessage: string;
            hookSpecificOutput: { hookEventName: string; additionalContext: string; permissionDecision?: string };
        };
        assert.equal(response.hookSpecificOutput.hookEventName, 'PreToolUse');
        assert.equal(response.hookSpecificOutput.permissionDecision, undefined);
        assert.match(response.systemMessage, /CREATES max-files 4 \(limit 3\)/u);
        assert.match(response.hookSpecificOutput.additionalContext, /nothing was blocked/u);
        assert.equal(ran.out.trimEnd().includes('\n'), false, 'one line of JSON');
    });

    it('hints at the folder that fits, and says nothing for a file that is fine', async () => {
        const root = drawer();
        const hint = await cli(root, ['hook', 'claude'], {}, hookInput(root, 'Write', 'core/layout/navbar-mobile.ts'));
        assert.match(
            (JSON.parse(hint.out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
                .additionalContext,
            /core\/layout\/navbar\/ exists/u,
        );
        const fine = await cli(root, ['hook', 'claude'], {}, hookInput(root, 'Write', 'core/layout/footer.ts'));
        assert.deepEqual([fine.code, fine.out], [0, '']);
    });

    it('says nothing for an Edit of a file that is there, another tool, or input it does not understand', async () => {
        const root = drawer();
        for (const stdin of [
            hookInput(root, 'Edit', 'core/enums/a.enum.ts'),
            hookInput(root, 'Write', 'core/enums/a.enum.ts'),
            hookInput(root, 'Bash', 'core/enums/new.enum.ts'),
            'not json',
            '',
        ]) {
            const ran = await cli(root, ['hook', 'claude'], {}, stdin);
            assert.deepEqual([ran.code, ran.out, ran.err], [0, '', ''], stdin);
        }
    });

    it('never fails the tool call: a broken configuration is exit 0, silent on standard output', async () => {
        const root = repository({ 'crowded-folders.config.json': '{ "extends": ["nope"] }', 'a/b.ts': '' });
        const ran = await cli(root, ['hook', 'claude'], {}, hookInput(root, 'Write', 'a/c.ts'));
        assert.deepEqual([ran.code, ran.out], [0, '']);
        assert.match(ran.err, /^crowded-folders hook: /u);
    });

    it('takes the folder from the cwd of the JSON, not from where it runs', async () => {
        const root = drawer();
        const elsewhere = repository({ 'x.txt': '' });
        const ran = await cli(elsewhere, ['hook', 'claude'], {}, hookInput(root, 'Write', 'core/enums/foo.enum.ts'));
        assert.match(ran.out, /CREATES max-files/u);
    });

    it('needs the agent it answers', async () => {
        const ran = await cli(drawer(), ['hook']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /hook takes the agent it answers: crowded-folders hook claude/u);
        assert.equal((await cli(drawer(), ['hook', 'cursor'])).code, 2);
    });
});

describe('crowded-folders init --agents', () => {
    it('creates .claude/settings.json and AGENTS.md, writes no configuration, and is the same the second time', async () => {
        const root = repository({ 'src/a.ts': '' });
        const first = await cli(root, ['init', '--agents']);
        assert.equal(first.code, 0, first.err);
        assert.match(first.out, /settings\.json: created with the PreToolUse hook/u);
        const settings = readFileSync(join(root, '.claude', 'settings.json'), 'utf8');
        const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
        assert.match(settings, /"command": "npx --no-install crowded-folders hook claude"/u);
        assert.ok(agents.startsWith(AGENTS_START) && agents.trimEnd().endsWith(AGENTS_END));
        assert.equal(existsSync(join(root, 'crowded-folders.config.json')), false);

        const second = await cli(root, ['init', '--agents']);
        assert.match(second.out, /has the PreToolUse hook[^\n]* already; unchanged\./u);
        assert.equal(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'), settings);
        assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), agents);
    });

    it('merges into the files there: other hooks stay, the text of AGENTS.md stays', async () => {
        const other = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo' }] }] } };
        const root = repository({
            '.claude/settings.json': JSON.stringify(other, undefined, 2),
            'AGENTS.md': '# Mine\n\nUse pnpm.\n',
        });
        const ran = await cli(root, ['init', '--agents']);
        assert.match(ran.out, /settings\.json: updated/u);
        const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as typeof other;
        assert.deepEqual(settings.hooks.PreToolUse[0], other.hooks.PreToolUse[0]);
        assert.equal(settings.hooks.PreToolUse.length, 2);
        assert.ok(readFileSync(join(root, 'AGENTS.md'), 'utf8').startsWith('# Mine\n\nUse pnpm.\n\n<!--'));
    });

    it('--dry-run prints the diff and writes nothing', async () => {
        const root = repository({ 'AGENTS.md': '# Mine\n' });
        const ran = await cli(root, ['init', '--agents', '--dry-run']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^--- \/dev\/null\n\+\+\+ b\/\.claude\/settings\.json\n@@ -0,0 \+1,\d+ @@\n\+\{/mu);
        assert.match(ran.out, /^--- a\/AGENTS\.md\n\+\+\+ b\/AGENTS\.md\n/mu);
        assert.match(ran.out, /^\+## Folder structure \(crowded-folders\)$/mu);
        assert.match(ran.out, /Dry run: nothing was written\./u);
        assert.equal(existsSync(join(root, '.claude')), false);
        assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# Mine\n');
    });

    it('stops on a settings file it cannot merge into, and changes neither file', async () => {
        const root = repository({ '.claude/settings.json': '{ // comment\n}' });
        const ran = await cli(root, ['init', '--agents']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /settings\.json is not valid JSON/u);
        assert.equal(existsSync(join(root, 'AGENTS.md')), false);
    });

    it('says when the project does not have the tool, since the hook runs the project copy', async () => {
        const root = repository({ 'a.ts': '' });
        assert.match((await cli(root, ['init', '--agents'])).out, /not installed in this project/u);
        writeFileSync(join(root, 'AGENTS.md'), 'x');
        assert.equal((await cli(root, ['init', '--dry-run'])).code, 2);
    });
});
