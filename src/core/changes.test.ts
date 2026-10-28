import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { changeBetween, compareWithBase, foldersOf } from './changes.ts';
import type { Finding } from './engine.ts';

const finding = (folder: string, rule: string, measured: number, key?: string): Finding => ({
    rule,
    severity: 'error',
    folder,
    message: `${rule} in ${folder}`,
    key,
    measured,
    limit: undefined,
    files: [],
    moves: [],
    url: undefined,
});

describe('changeBetween', () => {
    it('touches the folders a file was added to or removed from, and the parents of folders that came or went', () => {
        const base = ['src/widgets/a.ts', 'src/widgets/b.ts', 'src/kept.ts', 'docs/x.md'];
        const head = ['src/components/a.ts', 'src/components/b.ts', 'src/kept.ts', 'docs/x.md', 'docs/y.md'];
        const change = changeBetween(base, head);
        assert.deepEqual(
            [...change.touched].toSorted((a, b) => a.localeCompare(b)),
            ['docs', 'src', 'src/components', 'src/widgets'],
        );
        assert.deepEqual([...change.renamed], [['src/widgets', 'src/components']]);
        assert.equal(change.added, 3);
        assert.equal(change.removed, 2);
    });

    it('touches nothing when only contents changed', () => {
        const files = ['a/b.ts', 'c.ts'];
        assert.deepEqual([...changeBetween(files, files).touched], []);
    });

    it('does not call a folder renamed on one shared name out of many', () => {
        const base = ['a/index.ts', 'a/one.ts', 'a/two.ts', 'a/three.ts'];
        const head = ['b/index.ts'];
        assert.deepEqual([...changeBetween(base, head).renamed], []);
    });

    it('lists every folder above a file', () => {
        assert.deepEqual(
            [...foldersOf(['a/b/c.ts', 'a/d.ts'])].toSorted((a, b) => a.localeCompare(b)),
            ['.', 'a', 'a/b'],
        );
    });
});

describe('compareWithBase', () => {
    it('keeps what is new or grew, and knows what the base had, renamed folders included', () => {
        const base = [finding('old', 'max-files', 25), finding('lib', 'prefix-groups', 4, 'render')];
        const head = [
            finding('new', 'max-files', 25),
            finding('lib', 'prefix-groups', 5, 'render'),
            finding('lib', 'prefix-groups', 4, 'parse'),
            finding('moved', 'max-files', 24),
        ];
        const compared = compareWithBase(head, base, { label: 'origin/main', renamed: new Map([['old', 'moved']]) });
        assert.deepEqual(
            compared.kept.map(entry => `${entry.folder} ${entry.key ?? ''}`),
            ['new ', 'lib render', 'lib parse'],
        );
        assert.match(compared.kept[1]?.message ?? '', /\(4 on origin\/main; it has grown\.\)/u);
        assert.deepEqual(
            compared.known.map(entry => entry.folder),
            ['moved'],
        );
    });
});
