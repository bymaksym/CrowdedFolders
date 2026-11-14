import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Finding } from '../engine.ts';
import { asciiProse, wrapWords } from './ascii.ts';
import type { Report } from './report.ts';
import { formatText } from './text.ts';

const finding: Finding = {
    rule: 'prefix-groups',
    severity: 'error',
    folder: 'src/cli',
    message: '4 modules start with "render" (render-json, render-text, render-sarif, render-pr): a folder — render/.',
    key: 'render',
    measured: 4,
    limit: 3,
    files: ['src/cli/render-json.ts'],
    moves: [{ from: 'src/cli/render-json.ts', to: 'src/cli/render/render-json.ts' }],
    url: undefined,
};

const report = (findings: readonly Finding[], extra: Partial<Report> = {}): Report => ({
    tool: { name: 'crowded-folders', version: '1.2.3', url: 'https://example.com' },
    findings,
    suppressedCount: 0,
    staleSuppressions: [],
    folderCount: 10,
    fileCount: 100,
    rules: [],
    ...extra,
});

const plain = { color: false, moves: false } as const;

describe('--quiet in the text report', () => {
    it('says how many warnings it hid and prints no tip, no rule links', () => {
        const warn = { ...finding, severity: 'warn' as const, url: 'https://example.com/r' };
        const text = formatText(report([{ ...finding, url: 'https://example.com/r' }], { hiddenWarnings: 35 }), {
            ...plain,
            quiet: true,
        });
        assert.match(
            text,
            /1 error in 1 folder \(10 folders and 100 files checked; 35 warnings hidden by --quiet\)\./u,
        );
        assert.doesNotMatch(text, /0 warnings|--moves prints|Rule documentation/u);
        const loud = formatText(report([{ ...finding, url: 'https://example.com/r' }, warn]), plain);
        assert.match(loud, /--moves prints/u);
        assert.match(loud, /Rule documentation/u);
        assert.match(
            formatText(report([], { hiddenWarnings: 1 }), { ...plain, quiet: true }),
            /No errors \(.*; 1 warning hidden by --quiet\)/u,
        );
    });
});

describe('the final tip', () => {
    it('names the first folder of the report, so that it can be copied', () => {
        const text = formatText(report([{ ...finding, folder: 'apps/web src' }, finding]), plain);
        assert.match(text, /`crowded-folders explain 'apps\/web src'` shows how a folder was read\./u);
        const npx = formatText(report([finding]), { ...plain, command: 'npx crowded-folders' });
        assert.match(npx, /`npx crowded-folders explain src\/cli` shows/u);
    });
});

describe('a clean run', () => {
    it('names the folders nearest to their limit', () => {
        const text = formatText(
            report([], {
                closest: [
                    { folder: 'src/app/core/services', count: 9, limit: 10 },
                    { folder: 'src/app', count: 8, limit: 10 },
                ],
            }),
            plain,
        );
        assert.match(text, /\n {2}closest to the limit: src\/app\/core\/services 9\/10, src\/app 8\/10\n$/u);
        assert.doesNotMatch(formatText(report([]), plain), /closest/u);
    });
});

describe('the width of the terminal', () => {
    it('goes on under the message, not under the mark', () => {
        const text = formatText(report([finding]), { ...plain, width: 60 });
        const lines = text.split('\n').filter(line => line.startsWith(' '));
        assert.ok(lines.length > 2, text);
        for (const line of text.split('\n')) {
            assert.ok(line.length <= 60, `${line.length} columns: ${line}`);
        }
        const indent = '  ✖ error  prefix-groups  '.length;
        assert.ok((lines[1] ?? '').startsWith(' '.repeat(indent)));
        assert.notEqual((lines[1] ?? '')[indent], ' ');
    });

    it('wraps the summary with a hanging indent, and wraps nothing without a width', () => {
        const folders = Array.from({ length: 3 }, (_, index) => ({ ...finding, folder: `src/f${index}` }));
        const withWidth = formatText(report(folders, { suppressedCount: 12 }), { ...plain, width: 50 });
        assert.match(
            withWidth,
            /\n✖ 3 errors, 0 warnings in 3 folders \(10 folders\n {2}and 100 files checked; 12 problems suppressed\)\./u,
        );
        assert.ok((formatText(report([finding]), plain).split('\n', 2)[1] ?? '').endsWith('a folder — render/.'));
    });

    it('wraps the note on tiny files too, under its own words', () => {
        const crowded = { ...finding, rule: 'max-files', folder: 'src/types' };
        const text = formatText(
            report([crowded], { tinyFiles: { 'src/types': { tiny: 74, known: 92, bytes: 200 } } }),
            {
                ...plain,
                width: 50,
            },
        );
        const lines = text.split('\n');
        for (const line of lines) {
            assert.ok(line.length <= 50, `${line.length} columns: ${line}`);
        }
        const note = lines.findIndex(line => line.includes('note: 74 of its 92 files'));
        assert.ok(note > 0, text);
        // Four columns, the mark (✖ error) and "note: ": under its own words.
        assert.match(lines[note + 1] ?? '', /^ {17}\S/u);
    });

    it('never cuts a word that is longer than the room', () => {
        assert.deepEqual(wrapWords(`see ${'x'.repeat(60)} now`, 50, 0, 4), ['see', 'x'.repeat(60), 'now']);
        assert.deepEqual(wrapWords('a b c', undefined, 0, 0), ['a b c']);
        assert.deepEqual(wrapWords('a b c', 20, 0, 0), ['a b c']);
    });
});

describe('without symbols', () => {
    it('writes words instead of ✖ ⚠ ✔ — → …', () => {
        const warn = { ...finding, severity: 'warn' as const, folder: 'src/b' };
        const text = formatText(report([finding, warn], { staleSuppressions: [] }), { ...plain, symbols: false });
        assert.match(text, /^ {2}error {2}prefix-groups {2}4 modules/mu);
        assert.match(text, /^ {2}warn {3}prefix-groups/mu);
        assert.match(text, /^FAIL 1 error, 1 warning/mu);
        assert.match(text, /a folder - render\//u);
        assert.doesNotMatch(text, /[✖⚠✔—→…]/u);
        assert.match(formatText(report([]), { ...plain, symbols: false }), /^OK No crowded folders/u);
        assert.match(formatText(report([warn]), { ...plain, symbols: false }), /^WARN 0 errors, 1 warning/mu);
    });

    it('leaves a file name alone and changes only the prose', () => {
        assert.equal(asciiProse('a — b … c → d'), 'a - b ... c -> d');
        assert.equal(asciiProse('a—b.ts'), 'a—b.ts');
    });
});
