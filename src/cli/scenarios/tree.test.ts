import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseSizes } from '../../node/sizes.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const RECOMMENDED = { 'crowded-folders.config.json': '{ "extends": ["recommended"] }' };

/** `count` files in a folder, with names that do not form groups. */
const folderOf = (path: string, count: number, content = ''): Record<string, string> =>
    Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
            `${path}/f${String.fromCodePoint(97 + (index % 26))}${index}.txt`,
            content,
        ]),
    );

const REPO = {
    ...RECOMMENDED,
    ...folderOf('src/crowded', 25),
    ...folderOf('src/near', 14),
    ...folderOf('src/calm', 2),
    ...folderOf('docs', 1),
};

describe('crowded-folders tree', () => {
    it('prints each folder with its count, a bar and a word, and never fails', async () => {
        const root = repository(REPO);
        const ran = await cli(root, ['tree', '--depth', 'all']);
        assert.equal(ran.code, 0);
        assert.match(ran.out, /^\. +\d+\/40 +\S+ +\S+/mu);
        assert.match(ran.out, /crowded\/ +25\/20 +#{10}\+ +over the limit$/mu);
        assert.match(ran.out, /near\/ +14\/20 +#{7}\.{3} +near the limit$/mu);
        assert.match(ran.out, /calm\/ +2\/20 .* ok$/mu);
        assert.match(ran.out, /\d+ % of folders within the limit \(\d+\/\d+\); 1 over the limit; 1 near it\./u);
        assert.match(
            ran.out,
            /The biggest, src\/crowded: 25 modules: bigger than \d+ % of the folders of \d+ open-source/u,
        );
        assert.doesNotMatch(ran.out, /[├└│█]/u);
    });

    it('takes a folder, folds under --depth and filters with --over and --near', async () => {
        const root = repository(REPO);
        const folded = await cli(root, ['tree', '--depth', '1']);
        assert.match(folded.out, /src\/ .*\(3 folders below: 1 over, 1 near\)/u);
        assert.doesNotMatch(folded.out, /calm/u);

        const one = await cli(root, ['tree', 'src', '--over']);
        assert.match(one.out, /^src\//mu);
        assert.match(one.out, /crowded/u);
        assert.doesNotMatch(one.out, /near\/|calm|docs/u);

        const near = await cli(root, ['tree', 'src', '--near', '--depth', '5']);
        assert.match(near.out, /crowded[\s\S]*near\//u);
        assert.doesNotMatch(near.out, /calm/u);
    });

    it('is refused with options it does not take, and with --over and --near together', async () => {
        const root = repository(REPO);
        assert.match((await cli(root, ['tree', '--moves'])).err, /--moves does not apply to tree/u);
        assert.match((await cli(root, ['tree', '--over', '--near'])).err, /cannot both be given/u);
        assert.match((await cli(root, ['tree', '--depth', 'x'])).err, /--depth must be a whole number/u);
    });
});

describe('--format html', () => {
    it('writes one self-contained file, from check or from tree', async () => {
        const root = repository(REPO);
        const fromTree = await cli(root, ['tree', '-f', 'html=map.html']);
        assert.equal(fromTree.code, 0);
        const page = readFileSync(join(root, 'map.html'), 'utf8');
        assert.match(page, /^<!doctype html>/u);
        assert.match(page, /<div class="big">\d+<small>%/u);
        const fromCheck = await cli(root, ['-f', 'html=check.html']);
        assert.equal(fromCheck.code, 1);
        assert.match(readFileSync(join(root, 'check.html'), 'utf8'), /<div class="big">\d+<small>%/u);
    });
});

describe('--format badge', () => {
    it('is a shields.io endpoint for the share of folders within the limit', async () => {
        const root = repository(REPO);
        const ran = await cli(root, ['-f', 'badge']);
        assert.equal(ran.code, 1);
        const badge = JSON.parse(ran.out) as { schemaVersion: number; label: string; message: string; color: string };
        assert.equal(badge.schemaVersion, 1);
        assert.match(badge.message, /^\d+%$/u);
        assert.ok(['brightgreen', 'green', 'yellowgreen', 'yellow', 'orange', 'red'].includes(badge.color));
    });
});

describe('the health figure of the summary', () => {
    it('says how many folders are within the limit, on a clean run and on a failing one', async () => {
        const clean = await cli(repository({ ...RECOMMENDED, ...folderOf('src', 3) }), []);
        assert.match(
            clean.out,
            /\(\d+ folders? and \d+ files checked; 100 % of folders within the limit \(\d+\/\d+\)\)\./u,
        );
        const failing = await cli(repository(REPO), []);
        assert.match(failing.out, /checked; \d+ % of folders within the limit \(\d+\/\d+\)\)\.$/mu);
        assert.doesNotMatch(failing.out, /100 %/u);
    });

    it('does not put the folders in the JSON unless --stats asks for them', async () => {
        const root = repository(REPO);
        assert.equal('folders' in (JSON.parse((await cli(root, ['-f', 'json'])).out) as object), false);
        assert.equal('folders' in (JSON.parse((await cli(root, ['-f', 'json', '--stats'])).out) as object), true);
    });
});

describe('explain', () => {
    it('says how big the folder is among the folders of the field trial', async () => {
        const ran = await cli(repository(REPO), ['explain', 'src/crowded']);
        assert.match(
            ran.out,
            /^ {2}25 modules: bigger than \d+ % of the folders of \d+ open-source repositories \(n=[\d,]+\)\./mu,
        );
    });
});

describe('many tiny files', () => {
    const git = (root: string, ...args: string[]): void => {
        execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=n', ...args], { cwd: root, stdio: 'ignore' });
    };

    it('says so from the sizes git records, in the text report, the tree and the page', async () => {
        const root = repository({
            ...RECOMMENDED,
            ...folderOf('types', 16, 'export type A = B;\n'),
            ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`types/big${index}.txt`, 'x'.repeat(5000)])),
        });
        git(root, 'init', '-q');
        git(root, 'add', '-A');
        git(root, 'commit', '-q', '-m', 'x');
        const text = await cli(root, []);
        assert.match(text.out, /note: 16 of its 22 files are under 200 bytes: maybe they are one file\./u);
        assert.match((await cli(root, ['tree'])).out, /note: 16 of its 22 files are under 200 bytes/u);
        await cli(root, ['tree', '-f', 'html=map.html']);
        assert.match(readFileSync(join(root, 'map.html'), 'utf8'), /16 of its 22 files are under 200 bytes/u);
        assert.doesNotMatch((await cli(root, ['--quiet'])).out, /note:/u);
    });

    it('says nothing without git, or when the files are not tiny', async () => {
        const tiny = repository({ ...RECOMMENDED, ...folderOf('types', 22, 'export type A = B;\n') });
        assert.doesNotMatch((await cli(tiny, ['--no-git'])).out, /note:/u);
        const big = repository({ ...RECOMMENDED, ...folderOf('types', 22, 'x'.repeat(900)) });
        git(big, 'init', '-q');
        git(big, 'add', '-A');
        git(big, 'commit', '-q', '-m', 'x');
        assert.doesNotMatch((await cli(big, [])).out, /note:/u);
    });
});

describe('the sizes git records', () => {
    it('reads `git ls-tree -r -l -z`: blobs by path, and nothing for a submodule', () => {
        const output = [
            '100644 blob 1111111111111111111111111111111111111111      42\ta/b.ts',
            '100644 blob 2222222222222222222222222222222222222222       0\tc d.ts',
            '160000 commit 3333333333333333333333333333333333333333       -\tvendor/lib',
            '',
        ].join('\0');
        assert.deepEqual(
            [...parseSizes(output)],
            [
                ['a/b.ts', 42],
                ['c d.ts', 0],
            ],
        );
    });
});
