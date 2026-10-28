import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shownOf } from '../core/plural.ts';
import { formatGithub } from '../core/report/machine.ts';
import type { Report } from '../core/report/report.ts';
import { prefixGroup } from '../core/report/test-support/fixtures.ts';
import { listNames } from '../core/rules/rule.ts';
import { run } from './main.ts';
import { cleanUpAfterTests, cli, repository } from './test-support/harness.ts';

cleanUpAfterTests();

describe('singular and plural', () => {
    it('explain says 1 file, 1 module, 0 subfolders', async () => {
        const root = repository({ 'src/only.ts': '', 'crowded-folders.config.json': '{"extends":["recommended"]}' });
        const ran = await cli(root, ['explain', 'src']);
        assert.match(ran.out, /^src\/ {2}1 file, 1 module, 0 subfolders\n/u);
    });

    it('a run over a repository of one file says 1 folder and 1 file', async () => {
        const root = repository({ 'only.ts': '', 'crowded-folders.config.json': '{"extends":["recommended"]}' });
        const ran = await cli(root, []);
        assert.match(ran.out, /1 folder and 2 files checked/u);
    });
});

describe('a list that is cut', () => {
    it('never hides a single name: "and 1 more" takes the room of the name', () => {
        assert.equal(shownOf(6, 5), 6);
        assert.equal(shownOf(7, 5), 5);
        assert.equal(listNames(['a', 'b', 'c', 'd', 'e', 'f']), 'a, b, c, d, e, f');
        assert.equal(listNames(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'a, b, c, d, e and 2 more');
    });

    it('lists the 10th annotation instead of "and 1 more errors not shown"', () => {
        const findings = (count: number): Report['findings'] =>
            Array.from({ length: count }, (_, index) => ({ ...prefixGroup, folder: `src/f${index}` }));
        const report = (count: number): Report => ({
            tool: { name: 'crowded-folders', version: '1', url: '' },
            findings: findings(count),
            suppressedCount: 0,
            staleSuppressions: [],
            folderCount: count,
            fileCount: count,
            rules: [],
        });
        assert.doesNotMatch(formatGithub(report(10)), /more errors/u);
        assert.equal(formatGithub(report(10)).trim().split('\n').length, 10);
        assert.match(formatGithub(report(11)), /and 2 more errors not shown/u);
    });
});

describe('--quiet', () => {
    it('prints the problems and the summary, no note about detected presets and no tip', async () => {
        const files = {
            'cli/render-json.ts': '',
            'cli/render-text.ts': '',
            'cli/render-sarif.ts': '',
            'cli/render-pr.ts': '',
            'cli/main.ts': '',
        };
        const quiet = await cli(repository(files), ['--quiet']);
        assert.equal(quiet.code, 1);
        assert.doesNotMatch(quiet.err, /No configuration file/u);
        assert.doesNotMatch(quiet.out, /--moves prints|Rule documentation/u);
        const loud = await cli(repository(files), []);
        assert.match(loud.err, /No configuration file/u);
        assert.match(loud.out, /--moves prints/u);
    });
});

/** The command in a terminal of `columns` columns. */
async function inTerminal(
    cwd: string,
    args: readonly string[],
    columns: number,
    env: Readonly<Record<string, string>> = {},
): Promise<string> {
    let out = '';
    await run(args, {
        cwd,
        env,
        stdoutIsTTY: true,
        columns,
        write: text => {
            out += text;
        },
        error: text => {
            out += text.slice(0, 0);
        },
        readStdin: () => Promise.resolve(''),
    });
    return out;
}

describe('in a terminal', () => {
    it('a clean run shows the folders nearest to their limit', async () => {
        const files = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`src/m${index}.ts`, '']));
        const root = repository({ ...files, 'crowded-folders.config.json': '{"extends":["recommended"]}' });
        const out = await inTerminal(root, ['--no-color'], 100);
        assert.match(out, /\n {2}closest to the limit: src 17\/20\n$/u);
        assert.doesNotMatch((await cli(root, [])).out, /closest/u);
    });

    it('wraps a finding to the width of the terminal and names the first folder in the tip', async () => {
        const root = repository({
            'cli/render-json.ts': '',
            'cli/render-text.ts': '',
            'cli/render-sarif.ts': '',
            'cli/render-pr.ts': '',
            'cli/main.ts': '',
        });
        const out = await inTerminal(root, ['--no-color'], 60);
        for (const line of out.split('\n')) {
            // A link is not cut.
            assert.ok(line.length <= 60 || line.includes('https://'), `${line.length} columns: ${line}`);
        }
        assert.match(out, /✖ error {2}prefix-groups {2}/u);
        assert.match(out.replaceAll(/\s+/gu, ' '), /`crowded-folders explain cli` shows how a folder was read/u);
    });

    it('writes words, not symbols, for TERM=dumb', async () => {
        const root = repository({ 'a.ts': '' });
        assert.match(await inTerminal(root, ['--no-color'], 80, { TERM: 'dumb' }), /^OK No crowded folders/u);
    });
});
