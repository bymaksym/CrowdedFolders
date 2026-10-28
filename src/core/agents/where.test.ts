import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG } from '../config/types.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import { whereSummary, whereWouldGo } from './where.ts';

const resolve = (config: Config) => mergeLayer(EMPTY_CONFIG, config, 'test', true);
const enums = Array.from({ length: 14 }, (_, index) => `core/enums/enum-${index}-${'abcdefghijklmn'[index]}.enum.ts`);
const limits = resolve({
    rules: { 'max-files': ['error', { max: 14 }], 'prefix-groups': ['warn', { min: 4 }] },
});
const where = (files: readonly string[], path: string, config = limits) =>
    whereWouldGo({ files, config, rules: BUILT_IN_RULES, path });

describe('where a new file would go', () => {
    it('says WORSE when the folder is over its limit already, with the numbers (core/enums/foo-bar.enum.ts)', () => {
        const result = where([...enums, 'core/index.ts'], 'core/enums/foo-bar.enum.ts');
        assert.equal(result.effect, 'creates');
        assert.equal(whereSummary(result), 'CREATES max-files 15 (limit 14)');

        const crowded = [...enums, 'core/enums/extra.enum.ts'];
        const worse = where(crowded, 'core/enums/foo-bar.enum.ts');
        assert.equal(worse.effect, 'worsens');
        assert.equal(whereSummary(worse), 'WORSE max-files 15\u{2192}16 (limit 14)');
        assert.deepEqual(
            worse.changes.map(change => [change.change, change.before, change.after]),
            [['worse', 15, 16]],
        );
    });

    it('is OK when the folder has room, and names the folder that already fits the name (navbar/)', () => {
        const files = ['core/layout/navbar/navbar.component.ts', 'core/layout/header.component.ts'];
        const result = where(files, 'core/layout/navbar-mobile.component.ts');
        assert.equal(result.effect, 'neutral');
        assert.deepEqual(
            result.candidates.map(candidate => candidate.folder),
            ['core/layout/navbar'],
        );
        assert.equal(whereSummary(result), 'OK, and core/layout/navbar/ exists');
        assert.equal(where(files, 'core/layout/footer.component.ts').effect, 'neutral');
    });

    it('matches a plural folder and the longest prefix first', () => {
        const files = ['ui/user/a.ts', 'ui/user-card/b.ts', 'ui/x.ts'];
        const result = where(files, 'ui/user-card-small.ts');
        assert.deepEqual(
            result.candidates.map(candidate => candidate.folder),
            ['ui/user-card', 'ui/user'],
        );
        const plural = where(['ui/users/a.ts', 'ui/x.ts'], 'ui/user-list.ts');
        assert.equal(plural.candidates[0]?.folder, 'ui/users');
    });

    it('says which group a file joins when the folder is not yet a drawer of that name', () => {
        const files = ['api/render-json.ts', 'api/render-text.ts', 'api/main.ts'];
        const result = where(files, 'api/render-pr.ts');
        assert.equal(result.effect, 'neutral');
        assert.deepEqual(result.group, { key: 'render', modules: ['render-json', 'render-text'], min: 4 });
    });

    it('creates prefix-groups when the file completes a group, and proposes where its moves go', () => {
        const files = ['api/render-json.ts', 'api/render-text.ts', 'api/render-pr.ts', 'api/main.ts'];
        const result = where(files, 'api/render-sarif.ts');
        assert.equal(result.effect, 'creates');
        assert.equal(result.changes[0]?.rule, 'prefix-groups');
        assert.deepEqual(result.changes[0]?.moves, [{ from: 'api/render-sarif.ts', to: 'api/render/sarif.ts' }]);
        assert.deepEqual(
            result.candidates.map(candidate => [candidate.folder, candidate.kind]),
            [['api/render', 'move']],
        );
    });

    it('creates single-file-folders for a new folder, and fixes it when the second file arrives', () => {
        const strict = resolve({ rules: { 'single-file-folders': 'warn' } });
        const made = where(['src/a.ts'], 'src/new/only.ts', strict);
        assert.equal(made.effect, 'creates');
        // src had a single file and now has a folder; the new folder has a single file.
        const created = made.changes.find(change => change.change === 'new');
        assert.equal(created?.folder, 'src/new');
        assert.match(created?.message ?? '', /only\.ts/u);
        const second = where(['src/a.ts', 'src/new/only.ts'], 'src/new/two.ts', strict);
        assert.equal(second.effect, 'fixes');
        assert.equal(whereSummary(second), 'BETTER it fixes a problem of the folder');
    });

    it('reads the parent when the file makes a folder (max-folders)', () => {
        const config = resolve({ rules: { 'max-folders': ['error', { max: 2 }] } });
        const files = ['p/a/x.ts', 'p/b/y.ts'];
        const result = where(files, 'p/c/z.ts', config);
        assert.equal(result.effect, 'creates');
        assert.equal(result.changes[0]?.folder, 'p');
    });

    it('leaves a problem the file does not touch as it is: OK, not blamed on the file', () => {
        const crowded = [...enums, 'core/enums/extra.enum.ts', 'core/enums/readme.md'];
        const fewer = resolve({ rules: { 'max-files': ['error', { max: 3, count: 'modules' }] } });
        const result = where(crowded, 'core/enums/enum-0-a.enum.spec.ts', fewer);
        assert.equal(result.effect, 'neutral');
        assert.deepEqual(
            result.changes.map(change => change.change),
            ['same'],
        );
    });

    it('answers for a file that exists, and for one the configuration leaves out', () => {
        assert.equal(where(enums, enums[0] ?? '').effect, 'exists');
        const config = resolve({ exclude: ['dist'], rules: { 'max-files': ['error', { max: 1 }] } });
        const result = where(['dist/a.js', 'dist/b.js'], 'dist/c.js', config);
        assert.equal(result.effect, 'unchecked');
        assert.match(whereSummary(result), /^UNCHECKED the configuration leaves it out/u);
    });

    it('does what the engine does with the folder once the file is there', () => {
        // The folder scoped to its own subtree: files elsewhere do not change the answer.
        const elsewhere = Array.from({ length: 30 }, (_, index) => `other/f${index}.ts`);
        const result = where([...elsewhere, ...enums], 'core/enums/foo-bar.enum.ts');
        assert.equal(result.effect, 'creates');
        assert.equal(result.changes.length, 1);
    });
});
