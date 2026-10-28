import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareConfigs } from './config/compare.ts';
import { mergeLayer } from './config/merge.ts';
import { type Config, EMPTY_CONFIG } from './config/types.ts';
import { runEngine } from './engine.ts';
import {
    describeSeries,
    type FolderSeries,
    formatHistoryText,
    growingFolders,
    type HistorySample,
    sampleCommits,
    spanInWords,
    sparkline,
} from './history.ts';
import { BUILT_IN_RULES } from './rules/index.ts';

const point = (date: string, modules: number | null) => ({
    commit: `c${date}`,
    date: `${date}T00:00:00Z`,
    modules,
    files: modules,
});

describe('history', () => {
    it('samples evenly, oldest first, with the first and the last commit', () => {
        const log = Array.from({ length: 10 }, (_, index) => 9 - index); // newest first: 9 … 0
        assert.deepEqual(sampleCommits(log, 4), [0, 3, 6, 9]);
        assert.deepEqual(sampleCommits(log, 20), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        assert.deepEqual(sampleCommits([1], 2), [1]);
    });

    it('draws bars from 0 to the largest, a space where the folder was not, and ASCII without symbols', () => {
        assert.equal(sparkline([0, 4, 8, null]), '▁▅█ ');
        assert.equal(sparkline([0, 4, 8, null], false), '_+@ ');
        assert.equal(sparkline([0, 0]), '▁▁');
    });

    it('says a span as people do', () => {
        assert.equal(spanInWords('2026-10-28T10:00:00Z', '2026-10-28T12:00:00Z'), 'less than a day');
        assert.equal(spanInWords('2026-10-20', '2026-10-28'), 'eight days');
        assert.equal(spanInWords('2026-10-01', '2026-10-22'), 'three weeks');
        assert.equal(spanInWords('2026-04-28', '2026-10-28'), 'six months');
        assert.equal(spanInWords('2023-10-28', '2026-10-28'), 'three years');
        assert.equal(spanInWords('2010-10-28', '2026-10-28'), '16 years');
    });

    it('describes growth, a shrink, a folder that is gone and one that never was', () => {
        const series = (points: FolderSeries['points']): FolderSeries => ({ folder: 'src', points, limit: 20 });
        assert.equal(
            describeSeries(series([point('2026-04-28', 8), point('2026-10-28', 31)])),
            'src went from 8 to 31 modules in six months',
        );
        assert.equal(
            describeSeries(series([point('2026-04-28', 31), point('2026-10-28', 8)])),
            'src came down from 31 to 8 modules in six months',
        );
        assert.equal(
            describeSeries(series([point('2026-04-28', 3), point('2026-10-28', null)])),
            'src is gone: it had 3 modules at c2026-0',
        );
        assert.equal(describeSeries(series([point('2026-04-28', null)])), 'src is in none of the commits sampled');
        assert.equal(
            describeSeries(series([point('2026-04-28', null), point('2026-06-28', 4), point('2026-10-28', 6)])),
            'src went from 4 to 6 modules in four months since it appeared',
        );
    });

    it('lists the folders that grew, and says so when none did or nothing was sampled', () => {
        const at = (date: string, sizes: Record<string, number>): HistorySample => ({
            commit: `c${date}`,
            date,
            folders: new Map(
                Object.entries(sizes).map(([path, modules]) => [
                    path,
                    { path, modules, files: modules, subfolders: 0, limit: null },
                ]),
            ),
        });
        const samples = [at('2026-01-01', { a: 2, b: 5 }), at('2026-02-01', { a: 9, b: 5, c: 1 })];
        assert.deepEqual(
            growingFolders(samples, 10).map(series => series.folder),
            ['a'],
        );
        assert.match(formatHistoryText([], samples), /No folder grew between them\./u);
        assert.equal(formatHistoryText([], []), 'No commits to sample.\n');
        assert.deepEqual(growingFolders([], 3), []);
    });
});

describe('compareConfigs', () => {
    const resolved = (config: Config) => mergeLayer(EMPTY_CONFIG, config, 'test', true);
    const files = [...Array.from({ length: 25 }, (_, index) => `a/f${index}.ts`), 'b/x.ts'];
    const compare = (before: Config, after: Config) => {
        const findings = (config: Config) =>
            runEngine({ files, config: resolved(config), rules: BUILT_IN_RULES }).findings;
        return compareConfigs({
            label: 'main',
            before: resolved(before),
            after: resolved(after),
            rules: BUILT_IN_RULES,
            beforeFindings: findings(before),
            afterFindings: findings(after),
        });
    };

    it('names each setting it changes, in words', () => {
        const change = compare(
            {
                rules: { 'max-files': ['error', { max: 20 }], 'case-collision': 'error', 'prefix-groups': 'warn' },
                exclude: ['old'],
            },
            {
                rules: {
                    'max-files': ['warn', { max: 10, hint: 'Split it.' }],
                    'single-file-folders': 'warn',
                    'prefix-groups': ['warn', { ignore: ['user'] }],
                },
                exclude: ['new'],
                overrides: [{ folders: ['b'], reason: 'b is generated by a tool', rules: { 'max-files': 'off' } }],
            },
        );
        assert.deepEqual(change.settings, [
            'makes max-files a warning',
            'lowers max-files max from 20 to 10',
            'sets max-files hint to "Split it."',
            'turns case-collision off',
            'adds 1 entry to prefix-groups ignore',
            'turns single-file-folders on (warn)',
            'adds 1 pattern to exclude',
            'takes 1 pattern out of exclude',
            'adds 1 override',
        ]);
        assert.equal(change.added, 1);
        assert.match(
            change.summary,
            /^Since main, the configuration makes max-files a warning, .+ and adds 1 problem in 1 folder\.$/u,
        );
    });

    it('says when nothing changed in effect, and when the problems stay the same', () => {
        assert.equal(compare({}, {}).summary, 'The configuration is as it was on main, in effect.');
        assert.equal(
            compare(
                { rules: { 'max-folders': ['error', { max: 30 }] } },
                { rules: { 'max-folders': ['error', { max: 40 }] } },
            ).summary,
            'Since main, the configuration raises max-folders max from 30 to 40, and reports the same problems.',
        );
    });
});
