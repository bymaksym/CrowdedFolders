import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const OVERRIDE = JSON.stringify({
    extends: ['recommended'],
    overrides: [
        { folders: ['src'], reason: 'the app is a drawer on purpose', rules: { 'max-files': ['error', { max: 3 }] } },
    ],
});

describe('explain says where a value comes from', () => {
    it('names the preset or the override of each option, and hides the empty ones', async () => {
        const root = repository({
            'src/a.ts': '',
            'lib/b.ts': '',
            'crowded-folders.config.json': OVERRIDE,
        });
        const inSrc = await cli(root, ['explain', 'src']);
        assert.equal(inSrc.code, 0, inSrc.err);
        assert.match(inSrc.out, /error max-files <- crowded-folders\.config\.json, override src/u);
        assert.match(inSrc.out, /max: 3 <- crowded-folders\.config\.json, override src/u);
        assert.match(inSrc.out, /count: "modules" <- preset recommended/u);
        assert.doesNotMatch(inSrc.out, /hint: ""|hintFor: \[\]/u);
        const inLib = await cli(root, ['explain', 'lib']);
        assert.match(inLib.out, /max: 20 <- preset recommended/u);
        assert.match(inLib.out, /max-files <- preset recommended/u);
    });

    it('is the same in print-config, as a map of where each value comes from', async () => {
        const root = repository({ 'src/a.ts': '', 'crowded-folders.config.json': OVERRIDE });
        const printed = JSON.parse((await cli(root, ['print-config', 'src'])).out) as {
            rules: Record<string, [string, Record<string, unknown>]>;
            origins: Record<string, Record<string, string>>;
        };
        assert.equal(printed.rules['max-files']?.[1]['max'], 3);
        assert.equal('hint' in (printed.rules['max-files']?.[1] ?? {}), false);
        assert.equal(printed.origins['max-files']?.['max'], 'crowded-folders.config.json, override src');
        assert.equal(printed.origins['max-files']?.['count'], 'preset recommended');
        assert.equal(printed.origins['max-files']?.['filesPerModule'], undefined);
    });
});

describe('explain of a folder that is not checked', () => {
    it('says what excluded it, with the preset that wrote it, and is exit 0 (Unity Packages/)', async () => {
        const root = repository({
            'Packages/manifest.json': '',
            'Packages/packages-lock.json': '',
            'Assets/Scripts/Player.cs': '',
            'ProjectSettings/ProjectVersion.txt': '',
        });
        const ran = await cli(root, ['--preset', 'unity', 'explain', 'Packages']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(
            ran.out,
            /^Packages\/ {2}is not checked\n {2}all 2 files: excluded by \/Packages\/\*\.json \(preset unity\)\n$/u,
        );
    });

    it('says the file that wrote an exclude of the repository, and what an include leaves out', async () => {
        const root = repository({
            'old/a.ts': '',
            'new/b.ts': '',
            'crowded-folders.config.json': '{"extends":["recommended"],"exclude":["old"]}',
        });
        assert.match(
            (await cli(root, ['explain', 'old'])).out,
            /all 1 file: excluded by old \(crowded-folders\.config\.json\)/u,
        );
        const included = repository({
            'old/a.ts': '',
            'new/b.ts': '',
            'crowded-folders.config.json': '{"extends":["recommended"],"include":["new"]}',
        });
        assert.match((await cli(included, ['explain', 'old'])).out, /all 1 file: not taken by include \(new\)/u);
    });

    it('is still exit 2 for a folder that does not exist', async () => {
        const root = repository({ 'src/a.ts': '' });
        assert.equal((await cli(root, ['explain', 'nowhere'])).code, 2);
    });
});

describe('explain and the companions it applies', () => {
    it('says the files joined by the name up to the first dot, not "companions: none" (date.utils.spec.ts)', async () => {
        const root = repository({
            'src/date.utils.ts': '',
            'src/date.utils.spec.ts': '',
            'src/user.ts': '',
        });
        const ran = await cli(root, ['explain', 'src']);
        assert.doesNotMatch(ran.out, /companions: +none\n/u);
        assert.match(ran.out, /companions: +none configured/u);
        assert.match(
            ran.out,
            /joined by: +the name up to its first dot.*date\.utils\.spec\.ts \+ date\.utils\.ts -> date/u,
        );
        const alone = await cli(repository({ 'src/a.ts': '', 'src/b.ts': '' }), ['explain', 'src']);
        assert.match(alone.out, /joined by: +nothing/u);
    });
});

describe('explain --prompt', () => {
    const files = Object.fromEntries(
        [
            'render-json',
            'render-text',
            'render-pr',
            'render-sarif',
            'page-home',
            'page-about',
            'main',
            'util',
            'types',
            'index',
        ].flatMap(stem => [[`src/${stem}.ts`, ''] as const, [`src/${stem}.spec.ts`, ''] as const]),
    );

    it('prints the task: what is reported, the modules, the groups, the moves and the files to update', async () => {
        const root = repository({
            ...files,
            'cli/run.ts': "import { renderJson } from '../src/render-json';\n",
            'crowded-folders.config.json': JSON.stringify({ extends: ['recommended'] }),
        });
        const ran = await cli(root, ['explain', 'src', '--prompt']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^# Reorganise `src\/`\n/u);
        assert.match(ran.out, /## What it reports\n- error prefix-groups: 4 modules start with "render"/u);
        assert.match(ran.out, /^- render-json: render-json\.spec\.ts, render-json\.ts$/mu);
        assert.match(
            ran.out,
            /^- `render-\*` \(4\): render-json, render-pr, render-sarif, render-text - a folder nobody made$/mu,
        );
        assert.match(ran.out, /Near-groups[^\n]*\n- `page-\*` \(2\): page-about, page-home/u);
        assert.match(
            ran.out,
            /```sh\n# src: prefix-groups "render"\nmkdir -p src\/render\ngit mv src\/render-json\.spec\.ts src\/render\/json\.spec\.ts/u,
        );
        assert.match(ran.out, /## Files that name these paths\n[^\n]*\n- cli\/run\.ts\n/u);
        assert.match(ran.out, /update every import/iu);
        assert.match(ran.out, /Run the type check and the tests/u);
        assert.equal(existsSync(join(root, 'src', 'render')), false, 'nothing is moved');
    });

    it('says so for a folder with no problem, and for one with no move to propose', async () => {
        const root = repository({
            ...files,
            'crowded-folders.config.json': JSON.stringify({ rules: { 'max-files': ['error', { max: 5 }] } }),
            'ok/a.ts': '',
        });
        const clean = await cli(root, ['explain', 'ok', '--prompt']);
        assert.match(clean.out, /^# Nothing to reorganise in `ok\/`/u);
        const drawer = await cli(root, ['explain', 'src', '--prompt']);
        assert.match(drawer.out, /## Proposed moves\nThe tool proposes no move/u);
        assert.doesNotMatch(drawer.out, /## Files that name these paths/u);
    });

    it('is a usage error on a command that has no prompt', async () => {
        const ran = await cli(repository({ 'a.ts': '' }), ['rules', '--prompt']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /--prompt does not apply to rules; it applies to explain$/mu);
        // Nor on check, which would have printed the report as if it had not been given.
        const check = await cli(repository({ 'a.ts': '' }), ['--prompt']);
        assert.equal(check.code, 2);
        assert.match(check.err, /--prompt does not apply to check; it applies to explain/u);
    });
});
