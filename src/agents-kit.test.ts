import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOOK_COMMAND, HOOK_TIMEOUT, HOOK_TOOLS } from './core/agents/kit.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>;

interface HookGroup {
    matcher: string;
    hooks: { type: string; command: string; timeout: number }[];
}

describe('the Claude Code plugin shipped in the package', () => {
    const manifest = json('package.json') as { files: string[]; version: string };

    it('has the layout Claude Code requires: the manifest in .claude-plugin/, the rest at the root', () => {
        const plugin = json('.claude-plugin/plugin.json');
        assert.equal(plugin['name'], 'crowded-folders');
        // Claude Code refuses these prefixes for a plugin name.
        assert.doesNotMatch(plugin['name'], /^(?:claude-|anthropic-|anthropics-|cc-plugin-)/u);
        assert.equal(typeof plugin['description'], 'string');
        // No version of its own: it would be one more number to keep equal to package.json at each release.
        assert.equal('version' in plugin, false);
        for (const path of ['hooks/hooks.json', 'skills/crowded-folders/SKILL.md']) {
            assert.ok(existsSync(join(ROOT, path)), path);
        }
        for (const folder of ['.claude-plugin/', 'hooks/', 'skills/']) {
            assert.ok(manifest.files.includes(folder), `package.json "files" has ${folder}`);
        }
    });

    it('registers the same hook as init --agents, through the plugin root and node', () => {
        const file = json('hooks/hooks.json') as { hooks: Record<string, HookGroup[]> };
        // The wrapper "hooks" key is required: a file with only the event map fails to load.
        assert.deepEqual(Object.keys(file), ['hooks']);
        const [group, ...others] = file.hooks['PreToolUse'] ?? [];
        assert.equal(others.length, 0);
        assert.equal(group?.matcher, HOOK_TOOLS.join('|'));
        const [hook] = group?.hooks ?? [];
        assert.equal(hook?.type, 'command');
        assert.equal(hook?.timeout, HOOK_TIMEOUT);
        assert.equal(hook?.command, 'node "${CLAUDE_PLUGIN_ROOT}/bin/crowded-folders.js" hook claude');
        assert.ok(existsSync(join(ROOT, 'bin', 'crowded-folders.js')));
        assert.match(HOOK_COMMAND, /crowded-folders hook claude$/u);
    });
});

describe('skills/crowded-folders/SKILL.md', () => {
    const skill = read('skills/crowded-folders/SKILL.md');
    const [, front = '', body = ''] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(skill) ?? [];

    it('has the frontmatter Claude Code reads: a name equal to its folder and a description of when to use it', () => {
        assert.match(front, /^name: crowded-folders$/mu);
        const description = /^description: (.+)$/mu.exec(front)?.[1] ?? '';
        assert.ok(description.length > 80 && description.length < 1024, `${description.length} characters`);
        assert.match(description, /Use it (?:before|when)/u);
        assert.ok(body.startsWith('\n# crowded-folders'));
    });

    it('explains every verdict `where` can print, and only commands and options that exist', () => {
        for (const verdict of ['OK', 'WORSE', 'CREATES', 'BETTER', 'EXISTS', 'UNCHECKED']) {
            assert.match(body, new RegExp(`\`${verdict}\\b`, 'u'), verdict);
        }
        for (const command of [
            'where',
            'explain',
            'init --agents',
            '--prompt',
            '--fail-on worse',
            '--moves',
            '-f json',
        ]) {
            assert.ok(body.includes(command), command);
        }
    });
});
