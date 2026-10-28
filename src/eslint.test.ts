import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';

import { ESLint, RuleTester } from 'eslint';

import plugin, { resetAnalyses } from './eslint.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});
afterEach(() => {
    resetAnalyses();
});

/** A repository on disk, outside any git repository. */
function repository(files: Readonly<Record<string, string>>): string {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'crowded-folders-eslint-')));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

const CONFIG = JSON.stringify({ extends: ['recommended'] });
const RENDER = ['render-json', 'render-text', 'render-pr', 'render-sarif', 'main'].map(name => `cli/${name}.js`);
const crowded = (): string =>
    repository({
        'crowded-folders.config.json': CONFIG,
        'ok/a.js': '',
        'ok/b.js': '',
        ...Object.fromEntries(RENDER.map(path => [path, ''])),
    });

/** ESLint with the rule on, over a repository, as `eslint` would be started in it. */
function eslintIn(root: string, options: object = {}): ESLint {
    return new ESLint({
        cwd: root,
        overrideConfigFile: true,
        overrideConfig: [
            { plugins: { 'crowded-folders': plugin }, rules: { 'crowded-folders/folder': ['error', options] } },
        ],
    });
}

describe('crowded-folders/folder, run by ESLint', () => {
    it('reports the render group once, at line 1 of the first file of the folder', async () => {
        const root = crowded();
        const results = await eslintIn(root).lintFiles(['cli/*.js', 'ok/*.js']);
        const reported = results.filter(result => result.messages.length > 0);
        assert.equal(reported.length, 1);
        const [result] = reported;
        assert.equal(result?.filePath, join(root, 'cli', 'main.js'));
        assert.equal(result.messages.length, 1);
        const [message] = result.messages;
        assert.equal(message?.ruleId, 'crowded-folders/folder');
        assert.equal(message.line, 1);
        assert.equal(message.column, 1);
        assert.equal(message.severity, 2);
        assert.match(message.message, /render/u);
        assert.match(message.message, /\[prefix-groups\] https:\/\//u);
    });

    it('keeps reporting at the same file when it is linted again, as an editor does', async () => {
        const root = crowded();
        const eslint = eslintIn(root);
        const first = await eslint.lintFiles(['cli/render-pr.js']);
        const again = await eslint.lintFiles(['cli/render-pr.js']);
        assert.equal(first[0]?.messages.length, 1);
        assert.equal(again[0]?.messages.length, 1);
        const other = await eslint.lintFiles(['cli/main.js']);
        assert.equal(other[0]?.messages.length, 0, 'a second file of the folder says nothing');
    });

    it('says nothing for a folder without findings, and for code that is not a file', async () => {
        const root = crowded();
        const eslint = eslintIn(root);
        assert.deepEqual((await eslint.lintFiles(['ok/a.js']))[0]?.messages, []);
        const stdin = await eslint.lintText('');
        assert.deepEqual(stdin[0]?.messages, []);
    });

    it('takes the configuration from an option, and can report errors only', async () => {
        const root = repository({
            'custom.json': JSON.stringify({
                extends: ['recommended'],
                rules: { 'prefix-groups': 'warn', 'max-files': ['error', { max: 5 }] },
            }),
            ...Object.fromEntries(RENDER.map(path => [path, ''])),
            ...Object.fromEntries(
                ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map(n => [`big/${n}.js`, '']),
            ),
        });
        const ruleOf = (message: { message: string }): string | undefined => /\[([\w-]+)\]/u.exec(message.message)?.[1];
        const options = { config: 'custom.json' };
        const eslint = eslintIn(root, options);
        const found = await eslint.lintFiles(['cli/main.js', 'big/alpha.js']);
        assert.deepEqual(
            found.map(result => result.messages.map(message => ruleOf(message))),
            [['prefix-groups'], ['max-files']],
        );
        resetAnalyses();
        const errors = await eslintIn(root, { ...options, errorsOnly: true }).lintFiles([
            'cli/main.js',
            'big/alpha.js',
        ]);
        assert.deepEqual(
            errors.map(result => result.messages.map(message => ruleOf(message))),
            [[], ['max-files']],
        );
    });

    it('fails with the reason when the configuration is wrong', async () => {
        const root = repository({
            'crowded-folders.config.json': '{ "overrides": [{ "folders": ["a"] }] }',
            'a/x.js': '',
        });
        await assert.rejects(eslintIn(root).lintFiles(['a/x.js']), /could not analyse .*needs "reason"/su);
    });

    it('recommended is a flat config object that turns the rule on', () => {
        const { recommended } = plugin.configs;
        assert.equal(recommended.plugins['crowded-folders'], plugin);
        assert.equal(recommended.rules['crowded-folders/folder'], 'error');
    });

    it('rejects options it does not know', async () => {
        const root = crowded();
        await assert.rejects(eslintIn(root, { colour: true }).lintFiles(['ok/a.js']), /colour|additional/iu);
    });
});

describe("crowded-folders/folder, with ESLint's RuleTester", () => {
    const root = crowded();
    const rooted = (path: string): string => join(root, path);
    const home = process.cwd();
    // RuleTester lints from the working directory it is made in, which is where the rule looks for the repository.
    process.chdir(root);
    after(() => {
        process.chdir(home);
    });
    new RuleTester({ languageOptions: { sourceType: 'module' } }).run('folder', plugin.rules.folder, {
        valid: [{ code: '', filename: rooted('ok/a.js') }],
        invalid: [
            {
                code: '',
                filename: rooted('cli/main.js'),
                errors: [{ messageId: 'finding', line: 1, column: 1 }],
            },
        ],
    });
});
