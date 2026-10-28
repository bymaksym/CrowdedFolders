import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

function git(root: string, ...args: string[]): string {
    return execFileSync(
        'git',
        [
            '-C',
            root,
            '-c',
            'user.name=test',
            '-c',
            'user.email=test@example.com',
            '-c',
            'commit.gpgsign=false',
            ...args,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
}

function write(root: string, files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
}

/** Commits `files` at a date of its own, so that the history spans months. */
function commitAt(root: string, date: string, files: Readonly<Record<string, string>>): void {
    write(root, files);
    git(root, 'add', '-A');
    execFileSync(
        'git',
        [
            '-C',
            root,
            '-c',
            'user.name=test',
            '-c',
            'user.email=test@example.com',
            '-c',
            'commit.gpgsign=false',
            'commit',
            '-q',
            '-m',
            date,
        ],
        { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
    );
}

const named = (folder: string, count: number, from = 0): Record<string, string> =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`${folder}/file${from + index}.ts`, '']));

describe('crowded-folders history', () => {
    const root = repository({});
    git(root, 'init', '-q', '-b', 'main');
    commitAt(root, '2026-04-28T12:00:00Z', named('src/cli', 8));
    commitAt(root, '2026-06-28T12:00:00Z', named('src/cli', 8, 8));
    commitAt(root, '2026-08-28T12:00:00Z', { ...named('src/cli', 10, 16), ...named('src/core', 3) });
    commitAt(root, '2026-10-28T12:00:00Z', { ...named('src/cli', 5, 26), 'README.md': '' });

    it('says how one folder grew: "went from 8 to 31 modules in six months", with the samples', async () => {
        const ran = await cli(root, ['history', 'src/cli']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^4 commits sampled along the first parents, 2026-04-28 \(\w{7}\) -> 2026-10-28/u);
        assert.match(ran.out, /src\/cli {2}\S{4} {2}went from 8 to 31 modules in six months, limit 20/u);
        assert.match(ran.out, /^ {2}2026-06-28 {2}\w{7} +16 {2}16 files$/mu);
    });

    it('without a folder, lists the ones that grew the most; --samples takes fewer commits', async () => {
        const ran = await cli(root, ['history', '--samples', '2']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^2 commits sampled/u);
        const lines = ran.out.split('\n').filter(line => line.startsWith('src/'));
        assert.deepEqual(
            lines.map(line => line.split(' ', 1)[0]),
            ['src/cli'],
        );
    });

    it('prints the series as JSON', async () => {
        const ran = await cli(root, ['history', 'src/core', '-f', 'json']);
        const json = JSON.parse(ran.out) as {
            samples: unknown[];
            folders: { folder: string; growth: number; series: { modules: number | null }[] }[];
        };
        assert.equal(json.samples.length, 4);
        assert.deepEqual(
            json.folders[0]?.series.map(point => point.modules),
            [null, null, 3, 3],
        );
        assert.match(JSON.stringify(json.folders[0]), /"summary":"src\/core stayed at 3 modules since it appeared/u);
    });

    it('refuses what it cannot do: two folders, a format other than text or json, --stdin', async () => {
        assert.equal((await cli(root, ['history', 'a', 'b'])).code, 2);
        assert.match((await cli(root, ['history', '-f', 'sarif'])).err, /history prints text or json/u);
        assert.match((await cli(root, ['history', '--stdin'])).err, /--stdin does not apply to history/u);
        assert.match((await cli(root, ['--samples', '3'])).err, /--samples does not apply to check/u);
    });
});

describe('--compare-config', () => {
    const files = { ...named('a', 25), ...named('b', 30), ...named('c', 22), ...named('d', 5) };

    it('says what a raised limit silences: "raises max-files max from 20 to 40 and silences 3 problems in 3 folders"', async () => {
        const root = repository({});
        git(root, 'init', '-q', '-b', 'main');
        commitAt(root, '2026-10-01T12:00:00Z', {
            ...files,
            'crowded-folders.config.json': JSON.stringify({ extends: ['recommended'] }),
        });
        write(root, {
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                rules: { 'max-files': ['error', { max: 40 }] },
            }),
        });
        const ran = await cli(root, ['--compare-config', 'main', '-f', 'json']);
        assert.equal(ran.code, 0, ran.err);
        const expected =
            'Since main, the configuration raises max-files max from 20 to 40 and silences 3 problems in 3 folders.';
        assert.match(ran.err, new RegExp(`--compare-config: ${expected.replaceAll('.', String.raw`\.`)}`, 'u'));
        const json = JSON.parse(ran.out) as { configChange: { silenced: number; summary: string } };
        assert.equal(json.configChange.silenced, 3);
        assert.equal(json.configChange.summary, expected);
        const text = await cli(root, ['--compare-config', 'main']);
        assert.match(text.out, /Since main, the configuration raises max-files max/u);
    });

    it('reads only JSON configurations, and says why for a JavaScript one', async () => {
        const root = repository({});
        git(root, 'init', '-q', '-b', 'main');
        commitAt(root, '2026-10-01T12:00:00Z', {
            ...named('a', 3),
            'crowded-folders.config.mjs': 'export default { extends: ["recommended"] };',
        });
        const ran = await cli(root, ['--compare-config', 'main']);
        assert.equal(ran.code, 2);
        assert.match(
            ran.err,
            /--compare-config reads JSON configurations only, and crowded-folders\.config\.mjs is JavaScript/u,
        );
    });

    it('needs a configuration file, and a ref git knows where it existed', async () => {
        const root = repository({});
        git(root, 'init', '-q', '-b', 'main');
        commitAt(root, '2026-10-01T12:00:00Z', named('a', 3));
        assert.match((await cli(root, ['--compare-config', 'main'])).err, /this run has none/u);
        write(root, { 'crowded-folders.config.json': '{}' });
        assert.match(
            (await cli(root, ['--compare-config', 'main'])).err,
            /crowded-folders\.config\.json did not exist on main/u,
        );
        assert.match((await cli(root, ['--compare-config', 'nope'])).err, /git does not know "nope"/u);
        rmSync(join(root, 'crowded-folders.config.json'));
    });
});

describe('the pull-request comment (Markdown against a base)', () => {
    it('says what is new, what grew and what improved, and folds what was already there', async () => {
        const root = repository({});
        git(root, 'init', '-q', '-b', 'main');
        commitAt(root, '2026-10-01T12:00:00Z', { ...named('grows', 22), ...named('same', 23), ...named('fixed', 24) });
        git(root, 'checkout', '-q', '-b', 'feature');
        rmSync(join(root, 'fixed'), { recursive: true });
        commitAt(root, '2026-10-02T12:00:00Z', {
            ...named('grows', 3, 22),
            ...named('fixed', 5),
            ...named('new', 21, 100),
        });
        const ran = await cli(root, ['-f', 'markdown', '--base', 'main']);
        assert.equal(ran.code, 1, ran.err);
        assert.match(ran.out, /Against `main`: \*\*1 new\*\*, \*\*1 grew\*\*, 1 improved, 1 as they were\./u);
        assert.match(
            ran.out,
            /### New \(1\)\n\n\| Folder \| Rule \| Problem \|\n\| --- \| --- \| --- \|\n\| `new` \|/u,
        );
        assert.match(
            ran.out,
            /### Grew \(1\)\n\n\| Folder \| Rule \| Before \| Now \| Problem \|\n[^\n]+\n\| `grows` \| [^|]+ \| 22 \| 25 \|/u,
        );
        assert.match(ran.out, /### Improved \(1\)\n\n- `fixed` max-files: gone/u);
        assert.match(
            ran.out,
            /<details>\n<summary>As they were on main \(1\)<\/summary>\n\n[^\n]+\n[^\n]+\n\| `same` \|/u,
        );
        // --new-since leaves only what is new or grew in the report; the comment says the rest was there.
        const since = await cli(root, ['-f', 'markdown', '--new-since', 'main']);
        assert.match(since.out, /\*\*1 new\*\*, \*\*1 grew\*\*, 1 improved, 1 as they were/u);
        assert.doesNotMatch(since.out, /<details>/u);
    });
});
