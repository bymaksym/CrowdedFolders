import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { FolderStat } from '../../findings.ts';
import {
    buildFolderTree,
    describeHealth,
    describeHidden,
    flatten,
    healthOf,
    levelOf,
    treeRows,
} from './folder-tree.ts';
import { describeTiny, tinyFilesOf } from './tiny.ts';
import { type Cell, layoutTreemap, type Rect, squarify, type TreemapOptions } from './treemap.ts';
import { compareWithTrial, describeComparison } from './trial.ts';
import { FIELD_TRIAL } from './trial-data.ts';

/** A repeatable pseudo-random sequence (mulberry32), so a failing case can be run again. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = Math.trunc(state + 0x6d_2b_79_f5);
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

const area = (rect: Rect): number => rect.w * rect.h;

function overlap(a: Rect, b: Rect): number {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 1e-6 && h > 1e-6 ? w * h : 0;
}

describe('squarify', () => {
    it('gives each weight an area in proportion to it, filling the rectangle', () => {
        const next = random(7);
        for (let round = 0; round < 200; round++) {
            const weights = Array.from({ length: 1 + Math.floor(next() * 40) }, () => Math.ceil(next() * 100));
            const [x, y, w, h] = [next() * 50, next() * 50, 50 + next() * 900, 50 + next() * 700] as const;
            const rects = squarify(weights, x, y, w, h);
            const total = weights.reduce((sum, weight) => sum + weight, 0);
            assert.equal(rects.length, weights.length);
            let covered = 0;
            for (const [index, rect] of rects.entries()) {
                covered += area(rect);
                assert.ok(
                    Math.abs(area(rect) - ((weights[index] ?? 0) / total) * w * h) < 1e-6 * w * h,
                    'proportional',
                );
                assert.ok(rect.x >= x - 1e-6 && rect.y >= y - 1e-6, 'inside');
                assert.ok(rect.x + rect.w <= x + w + 1e-6 && rect.y + rect.h <= y + h + 1e-6, 'inside');
            }
            assert.ok(Math.abs(covered - w * h) < 1e-6 * w * h, 'no gap');
            for (let a = 0; a < rects.length; a++) {
                for (let b = a + 1; b < rects.length; b++) {
                    assert.equal(overlap(rects[a]!, rects[b]!), 0, `${a} and ${b} overlap`);
                }
            }
        }
    });

    it('keeps rectangles squarer than a slice would (the example of the paper, in 6 by 4)', () => {
        const rects = squarify([6, 6, 4, 3, 2, 2, 1], 0, 0, 6, 4);
        const worst = Math.max(...rects.map(rect => Math.max(rect.w / rect.h, rect.h / rect.w)));
        assert.ok(worst < 3, `worst aspect ratio ${worst}`);
        // Slicing 24 into a strip for the smallest would be 1 by 24 / 24 = a ratio of 24.
    });

    it('answers in the order it was given, and an item of no weight gets an empty rectangle', () => {
        const rects = squarify([1, 0, 3], 0, 0, 100, 40);
        assert.equal(area(rects[1]!), 0);
        assert.ok(area(rects[2]!) > area(rects[0]!));
        assert.deepEqual(squarify([], 0, 0, 10, 10), []);
        assert.equal(area(squarify([5], 0, 0, 0, 10)[0]!), 0);
    });

    it('is the same picture for the same input', () => {
        assert.deepEqual(squarify([3, 3, 3, 1], 0, 0, 90, 60), squarify([3, 3, 3, 1], 0, 0, 90, 60));
    });
});

const OPTIONS: TreemapOptions = { depth: 2, header: 20, gap: 3, openWidth: 100, openHeight: 60, most: 4 };

describe('layoutTreemap', () => {
    const leaf = (weight: number): { w: number; s: number } => ({ w: weight, s: weight });
    const tree = {
        w: 60,
        s: 4,
        c: [{ w: 30, s: 2, c: [leaf(10), leaf(10), leaf(8)] }, leaf(15), leaf(11)],
    };

    it('draws a folder before what is inside it, and gives its own files a cell beside its folders', () => {
        const cells = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 500 }, OPTIONS);
        const open = cells.findIndex(cell => cell.open);
        assert.ok(open !== -1);
        const opened = cells[open];
        assert.equal(opened?.node, tree.c[0]);
        const inside = cells.filter(cell => cell.parent === tree.c[0]);
        assert.ok(inside.length >= 4, 'three folders and its own files');
        assert.ok(inside.some(cell => cell.self));
        for (const cell of inside) {
            assert.ok(cells.indexOf(cell) > open);
            assert.ok(cell.x >= (opened?.x ?? 0) && cell.y >= (opened?.y ?? 0) + OPTIONS.header);
        }
        assert.ok(cells.some(cell => !cell.self && cell.parent === tree && !cell.open));
    });

    it('does not open a folder that has no room, and stops at the depth', () => {
        const small = layoutTreemap(tree, { x: 0, y: 0, w: 120, h: 80 }, OPTIONS);
        assert.equal(
            small.some(cell => cell.open),
            false,
        );
        const flat = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 500 }, { ...OPTIONS, depth: 1 });
        assert.equal(
            flat.every(cell => cell.depth === 1 && !cell.open),
            true,
        );
    });

    it('folds the smallest into one cell when there are more than `most`', () => {
        const many = { w: 50, s: 0, c: Array.from({ length: 10 }, () => leaf(5)) };
        const cells = layoutTreemap(many, { x: 0, y: 0, w: 400, h: 300 }, OPTIONS);
        assert.equal(cells.length, OPTIONS.most);
        const rest = cells.find(cell => cell.rest !== undefined);
        assert.equal(rest?.rest?.length, 7);
    });

    it('never overlaps what it draws side by side', () => {
        const cells = layoutTreemap(tree, { x: 0, y: 0, w: 800, h: 500 }, OPTIONS);
        for (const parent of new Set(cells.map(cell => cell.parent))) {
            const group = cells.filter(cell => cell.parent === parent);
            for (const [a, first] of group.entries()) {
                for (const second of group.slice(a + 1)) {
                    assert.equal(overlap(first, second), 0);
                }
            }
        }
    });
});

/** What a cell says about where it is, without the nodes it points at. */
const placed = (cells: readonly Cell[]): unknown[] =>
    Array.from(cells, cell => [cell.x, cell.y, cell.w, cell.h, cell.depth, cell.open, cell.self]);

const corners = (rects: readonly Rect[]): number[][] => Array.from(rects, rect => [rect.x, rect.y, rect.w, rect.h]);

describe('the layout that runs in the page', () => {
    it('is the text of the two functions, and needs nothing else to give the same answer', () => {
        const source = `${squarify.toString()}
${layoutTreemap.toString()}`;
        const run = runInNewContext(
            `${source}
[squarify, layoutTreemap]`,
            {},
        ) as unknown as [typeof squarify, typeof layoutTreemap];
        const weights = [9, 7, 5, 5, 3, 1];
        assert.deepEqual(corners(run[0](weights, 0, 0, 300, 200)), corners(squarify(weights, 0, 0, 300, 200)));
        const node = {
            w: 20,
            s: 2,
            c: [
                { w: 12, s: 12 },
                { w: 6, s: 6 },
            ],
        };
        const rect = { x: 0, y: 0, w: 300, h: 200 };
        assert.deepEqual(placed(run[1](node, rect, OPTIONS)), placed(layoutTreemap(node, rect, OPTIONS)));
    });
});

const stat = (path: string, used: number, limit: number | null): FolderStat => ({
    path,
    modules: used,
    files: used,
    subfolders: 0,
    limit,
    unit: 'modules',
    used,
});

describe('levels', () => {
    it('are words for how near a folder is to its limit', () => {
        assert.equal(levelOf(5, 20), 'ok');
        assert.equal(levelOf(11, 20), 'ok');
        assert.equal(levelOf(12, 20), 'near');
        assert.equal(levelOf(20, 20), 'near');
        assert.equal(levelOf(21, 20), 'over');
        assert.equal(levelOf(99, null), 'none');
    });
});

const STATS = [
    stat('.', 2, 40),
    stat('src', 25, 20),
    stat('src/a', 13, 20),
    stat('src/b', 3, 20),
    stat('docs', 1, 20),
    stat('docs/x/y', 1, null),
];

describe('the folder tree', () => {
    it('hangs each folder from its nearest ancestor and weighs it with what is below', () => {
        const [root, ...other] = buildFolderTree(STATS);
        assert.equal(other.length, 0);
        assert.deepEqual(
            root?.children.map(child => child.path),
            ['docs', 'src'],
        );
        const docs = root?.children[0];
        assert.equal(docs?.children[0]?.path, 'docs/x/y');
        assert.equal(docs?.children[0]?.name, 'y');
        assert.equal(root?.weight, 2 + (1 + 1) + (25 + 13 + 3));
        assert.equal(flatten([root as never]).length, STATS.length);
    });

    it('is a forest when a run covers some folders only, and gives an empty folder room', () => {
        const forest = buildFolderTree([stat('src/a', 4, 20), stat('lib', 0, 20)]);
        assert.deepEqual(
            forest.map(node => node.path),
            ['lib', 'src/a'],
        );
        assert.equal(forest[0]?.weight, 1);
    });

    it('says what share of the folders with a limit are within it, never 100 when one is not', () => {
        assert.deepEqual(healthOf(STATS), { within: 4, total: 5, percent: 80 });
        const many = Array.from({ length: 300 }, (_, index) => stat(`f${index}`, index === 0 ? 30 : 1, 20));
        const health = healthOf(many);
        assert.equal(health?.percent, 99);
        assert.equal(
            describeHealth({ within: 113, total: 119, percent: 95 }),
            '95 % of folders within the max-files limit (113/119)',
        );
        assert.equal(healthOf([stat('a', 1, null)]), undefined);
        assert.equal(healthOf([stat('a', 1, 20)])?.percent, 100);
    });

    it('keeps the way to a problem, folds what the depth hides and counts it', () => {
        const roots = buildFolderTree(STATS);
        const only = treeRows(roots, { depth: 9, only: 'over' });
        assert.deepEqual(
            only.map(row => row.node.path),
            ['.', 'src'],
        );
        const near = treeRows(roots, { depth: 9, only: 'near' });
        assert.deepEqual(
            near.map(row => row.node.path),
            ['.', 'src', 'src/a'],
        );
        const folded = treeRows(roots, { depth: 0 });
        assert.equal(folded.length, 1);
        assert.deepEqual(folded[0]?.hidden, { folders: 5, over: 1, near: 1 });
        assert.equal(
            describeHidden(folded[0]?.hidden ?? { folders: 0, over: 0, near: 0 }),
            '5 folders below: 1 over, 1 near',
        );
        assert.equal(describeHidden({ folders: 0, over: 0, near: 0 }), '');
        const all = treeRows(roots, { depth: 9 });
        assert.equal(all.at(-1)?.last, true);
        assert.deepEqual(all.find(row => row.node.path === 'src/b')?.trail, [false, false]);
    });
});

describe('the field trial', () => {
    const trial = { repos: 3, folders: 10, modules: [0, 4, 3, 2, 1] };

    it('says how many of the folders a folder is bigger than, rounded down, with the n', () => {
        assert.deepEqual(compareWithTrial(3, trial), { biggerThan: 70, folders: 10, repos: 3 });
        assert.equal(compareWithTrial(1, trial)?.biggerThan, 0);
        assert.equal(compareWithTrial(99, trial)?.biggerThan, 100);
        assert.equal(compareWithTrial(0, trial), undefined);
        assert.equal(compareWithTrial(3, { repos: 0, folders: 0, modules: [] }), undefined);
        assert.equal(
            describeComparison(3, trial),
            '3 modules: bigger than 70 % of the folders of 3 open-source repositories (n=10).',
        );
    });

    it('has data that was measured, written by the tool: the counts add up to n', () => {
        assert.ok(FIELD_TRIAL.repos >= 30);
        assert.equal(
            FIELD_TRIAL.modules.reduce((sum, count) => sum + count, 0),
            FIELD_TRIAL.folders,
        );
        assert.equal(FIELD_TRIAL.modules[0], 0);
        const sentence = describeComparison(29);
        assert.match(
            sentence ?? '',
            /^29 modules: bigger than \d+ % of the folders of \d+ open-source repositories \(n=[\d,]+\)\.$/u,
        );
    });
});

describe('tiny files', () => {
    const sizes = new Map<string, number>();
    const files: string[] = [];
    for (let index = 0; index < 92; index++) {
        const file = `domain/I${index}.ts`;
        files.push(file);
        sizes.set(file, index < 74 ? 60 : 4000);
    }

    it('notes that most files are under 200 bytes, from sizes alone', () => {
        const found = tinyFilesOf(files, sizes);
        assert.deepEqual(found, { tiny: 74, known: 92, bytes: 200 });
        assert.equal(describeTiny(found as never), '74 of its 92 files are under 200 bytes: maybe they are one file.');
    });

    it('says nothing for few, for a minority, or for files whose size it does not know', () => {
        assert.equal(tinyFilesOf(files.slice(60), sizes), undefined);
        assert.equal(tinyFilesOf(files, new Map(files.map(file => [file, 5000]))), undefined);
        assert.equal(tinyFilesOf(files, new Map()), undefined);
        assert.equal(
            tinyFilesOf(
                ['a', 'b', 'c', 'd', 'e'],
                new Map([
                    ['a', 1],
                    ['b', 1],
                    ['c', 1],
                    ['d', 1],
                    ['e', 1],
                ]),
            )?.tiny,
            5,
        );
        assert.equal(
            tinyFilesOf(
                ['a', 'b', 'c', 'd'],
                new Map([
                    ['a', 1],
                    ['b', 1],
                    ['c', 1],
                    ['d', 1],
                ]),
            ),
            undefined,
        );
    });
});
