import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Finding } from '../engine.ts';
import type { Report } from './report.ts';
import { formatText } from './text.ts';

const finding: Finding = {
    rule: 'prefix-groups',
    severity: 'error',
    folder: 'cli',
    message: '4 modules start with "render": a folder, 100% | sure',
    key: 'render',
    measured: 4,
    limit: 3,
    files: ['cli/render-json.ts', 'cli/render-pr.ts'],
    moves: [{ from: 'cli/render-json.ts', to: 'cli/render/render-json.ts' }],
    url: 'https://example.com/prefix-groups',
};

const report = (findings: readonly Finding[], extra: Partial<Report> = {}): Report => ({
    tool: { name: 'crowded-folders', version: '1.2.3', url: 'https://example.com' },
    findings,
    suppressedCount: 0,
    staleSuppressions: [],
    folderCount: 10,
    fileCount: 100,
    rules: [{ id: 'prefix-groups', description: 'groups', url: 'https://example.com/prefix-groups' }],
    ...extra,
});

describe('formatText', () => {
    it('groups by folder and ends with the totals', () => {
        const text = formatText(
            report([finding, { ...finding, folder: '.', rule: 'max-files', severity: 'warn', key: undefined }]),
            {
                color: false,
                moves: false,
            },
        );
        assert.match(text, /^\. \(the root\)\n {2}⚠ warn /mu);
        assert.match(text, /^cli\/\n {2}✖ error {2}prefix-groups/mu);
        assert.match(text, /1 error, 1 warning in 2 folders \(10 folders and 100 files checked\)\./u);
        assert.match(text, /--moves prints/u);
        assert.equal(text.includes('\u{1B}['), false);
    });

    it('prints moves, colours and stale suppressions when asked', () => {
        const text = formatText(
            report([finding], {
                staleSuppressions: [{ folder: 'src', id: 'max-files', count: 30, measured: 28 }],
                suppressedCount: 2,
            }),
            { color: true, moves: true },
        );
        assert.match(text, /git mv cli\/render-json\.ts cli\/render\/render-json\.ts/u);
        assert.ok(text.includes('\u{1B}[31m'));
        assert.match(text, /suppressed at 30, now 28/u);
        assert.match(text, /2 problems suppressed/u);
    });

    it('says so when there is nothing', () => {
        assert.match(
            formatText(report([]), { color: false, moves: false }),
            /^✔ No crowded folders \(10 folders and 100 files checked\)\.\n$/u,
        );
    });
});

describe('formatText, safe to print', () => {
    it('writes a control character as a hex escape, so a folder name cannot recolour or invent a line', () => {
        const hostile = { ...finding, folder: 'ctrl\u{1B}[31m', message: 'a\nb ::error::fake', files: [] };
        const text = formatText(report([hostile]), { color: false, moves: false });
        assert.equal(text.includes('\u{1B}'), false);
        assert.match(text, /^ctrl\\x1b\[31m\/$/mu);
        assert.match(text, /a\\x0ab ::error::fake/u);
    });

    it('links each rule to its documentation: a footer on a pipe, OSC 8 on a terminal', () => {
        const piped = formatText(report([finding]), { color: false, moves: false });
        assert.match(piped, /Rule documentation\n {2}prefix-groups {2}https:\/\/example\.com\/prefix-groups\n$/u);
        const terminal = formatText(report([finding]), { color: false, moves: false, hyperlinks: true });
        assert.ok(
            terminal.includes('\u{1B}]8;;https://example.com/prefix-groups\u{1B}\\prefix-groups\u{1B}]8;;\u{1B}\\'),
        );
        assert.equal(terminal.includes('Rule documentation'), false);
    });

    it('groups by project, the worst first, with an overview', () => {
        const mine = (project: string | null, folder: string, severity: 'error' | 'warn') => ({
            ...finding,
            project,
            folder,
            severity,
        });
        const text = formatText(
            report([
                mine('apps/web', 'apps/web/src', 'warn'),
                mine('apps/api', 'apps/api/src', 'error'),
                mine('apps/api', 'apps/api/lib', 'error'),
                mine(null, 'tools', 'warn'),
            ]),
            { color: false, moves: false, groupBy: 'project' },
        );
        assert.match(text, /^Top 3 projects\n {2}apps\/api\s+2 errors, 0 warnings\n/u);
        assert.ok(text.indexOf('\napps/api\n') < text.indexOf('\napps/web\n'));
        assert.match(text, /\(no project\)\n {2}⚠ warn\s+prefix-groups {2}tools: 4 modules/u);
    });
});
