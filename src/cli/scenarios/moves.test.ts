import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { RENDER_FILES } from '../test-support/fixtures.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const RECOMMENDED = { 'crowded-folders.config.json': '{ "extends": ["recommended"] }' };

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

describe('--moves', () => {
    it('makes the folder before its git mv, so the commands run as printed', async t => {
        const root = repository({ ...RENDER_FILES, ...RECOMMENDED });
        const ran = await cli(root, ['--moves', '--no-git']);
        const commands = ran.out.split('\n').map(line => line.trim());
        const mkdir = commands.indexOf('mkdir -p cli/render');
        assert.ok(mkdir !== -1, ran.out);
        assert.ok(mkdir < commands.indexOf('git mv cli/render-json.ts cli/render/json.ts'), ran.out);

        if (!hasSh) {
            t.skip('no sh to run the script with');
            return;
        }
        const script = await cli(root, ['--moves=sh', '--no-git']);
        execFileSync('git', ['init', '-q'], { cwd: root });
        execFileSync('git', ['add', '-A'], { cwd: root });
        execFileSync('sh', ['-c', script.out], { cwd: root });
        assert.ok(existsSync(join(root, 'cli/render/json.ts')));
    });

    it('--moves=sh and --moves=pwsh print only the commands, quoted for that shell', async () => {
        const root = repository({
            ...RECOMMENDED,
            "it's/render-json.ts": '',
            "it's/render-text.ts": '',
            "it's/render-sarif.ts": '',
            "it's/render-pr.ts": '',
            "it's/main.ts": '',
        });
        const sh = await cli(root, ['--moves=sh', '--no-git']);
        assert.equal(sh.code, 1, 'the exit code is the check’s');
        assert.deepEqual(sh.out.split('\n').slice(0, 3), [
            `# it's: prefix-groups "render" — no other tracked file names these paths`,
            String.raw`mkdir -p 'it'\''s/render'`,
            String.raw`git mv 'it'\''s/render-json.ts' 'it'\''s/render/json.ts'`,
        ]);
        assert.equal(sh.out.includes('\u{1B}'), false, 'no colour');
        const pwsh = await cli(root, ['--moves=pwsh', '--no-git']);
        assert.deepEqual(pwsh.out.split('\n').slice(1, 3), [
            `New-Item -ItemType Directory -Force -Path 'it''s/render' | Out-Null`,
            `git mv 'it''s/render-json.ts' 'it''s/render/json.ts'`,
        ]);
    });

    it('names the files that name the paths it moves (package.json, check.mjs)', async () => {
        const root = repository({
            ...RECOMMENDED,
            'tools/validate-i18n.mjs': '',
            'tools/validate-links.mjs': '',
            'tools/validate-env.mjs': '',
            'tools/validate-schema.mjs': '',
            'tools/check.mjs': "import './validate-links.mjs';\n",
            'tools/notes.md': 'validate-envx.mjs is another thing\n',
            'package.json': '{ "scripts": { "i18n": "node tools/validate-i18n.mjs" } }\n',
        });
        const text = await cli(root, ['--moves', '--no-git']);
        assert.match(text.out, /2 files name these paths: package\.json, tools\/check\.mjs\n/u);
        const json = JSON.parse((await cli(root, ['--moves=json', '--no-git'])).out) as {
            groups: { folder: string; directories: string[]; moves: unknown[]; references: string[] }[];
        };
        assert.deepEqual(json.groups[0]?.references, ['package.json', 'tools/check.mjs']);
        assert.deepEqual(json.groups[0]?.directories, ['tools/validate']);
        assert.equal(json.groups[0]?.moves.length, 4);
    });

    it('says when a folder over max-files has nothing to move', async () => {
        const files = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`core/enums/e${index}x.ts`, '']));
        const root = repository({ ...RECOMMENDED, ...files });
        const ran = await cli(root, ['--moves', '--no-git']);
        assert.match(
            ran.out,
            /no group to move out of it — `crowded-folders explain core\/enums` shows the groups that come close/u,
        );
    });

    it('refuses a value it does not know, and a report that would share standard output', async () => {
        const root = repository({ ...RENDER_FILES, ...RECOMMENDED });
        const bash = await cli(root, ['--moves=bash', '--no-git']);
        assert.equal(bash.code, 2);
        assert.match(bash.err, /--moves takes no value, or one of sh, pwsh, json, not "bash"/u);
        const both = await cli(root, ['--moves=sh', '-f', 'json', '--no-git']);
        assert.equal(both.code, 2);
        assert.match(both.err, /give the report a file/u);
        const toFile = await cli(root, ['--moves=sh', '-f', 'json=report.json', '--no-git']);
        assert.match(toFile.out, /^# cli: prefix-groups "render"/u);
        assert.ok(existsSync(join(root, 'report.json')));
    });
});

describe('explain', () => {
    it('shows the groups that come close in a folder over max-files with nothing to move (core/enums)', async () => {
        const names = [
            'page-a',
            'page-b',
            'page-c',
            'ws-a',
            'ws-b',
            'alpha',
            'beta',
            'gamma',
            'delta',
            'epsilon',
            'zeta',
            'eta',
            'theta',
            'iota',
        ];
        const root = repository({
            'crowded-folders.config.json':
                '{ "extends": ["recommended"], "rules": { "max-files": ["error", { "max": 10 }] } }',
            ...Object.fromEntries(names.map(name => [`core/enums/${name}.ts`, ''])),
        });
        const ran = await cli(root, ['explain', 'core/enums', '--no-git']);
        assert.match(
            ran.out,
            /Groups that come close \(prefix-groups needs 4\)\n {2}core\/enums \(14\/10\): page-\* ×3, ws-\* ×2\n/u,
        );
    });
});
