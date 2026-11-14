/**
 * The command as a repository adopting it uses it: suppressions, what a run over some folders or
 * over a change says, and the summary next to the exit code. Each scenario is one a reviewer ran.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { ciBaseOf } from '../../node/git-base.ts';
import type { Io } from '../io.ts';
import { run } from '../main.ts';

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

function folder(): string {
    const root = mkdtempSync(join(tmpdir(), 'crowded-folders-adopt-'));
    roots.push(root);
    return root;
}

function write(root: string, files: Readonly<Record<string, string>>): void {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
}

/** A repository on disk (without git: the file list comes from walking it). */
function repository(files: Readonly<Record<string, string>>): string {
    const root = folder();
    write(root, files);
    return root;
}

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

/** A git repository with `files` committed on `main`. */
function gitRepository(files: Readonly<Record<string, string>>): string {
    const root = repository(files);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    return root;
}

interface Ran {
    readonly code: number;
    readonly out: string;
    readonly err: string;
}

async function cli(cwd: string, args: readonly string[], env: Io['env'] = {}): Promise<Ran> {
    let out = '';
    let error = '';
    const io: Io = {
        cwd,
        env,
        stdoutIsTTY: false,
        write: text => {
            out += text;
        },
        error: text => {
            error += text;
        },
        readStdin: () => Promise.resolve(''),
    };
    const code = await run(args, io);
    return { code, out, err: error };
}

const SUPPRESSIONS = 'crowded-folders-suppressions.json';
const readJson = (root: string, path = SUPPRESSIONS): unknown => JSON.parse(readFileSync(join(root, path), 'utf8'));

/** Five files, four of them `render-*`: a prefix group in `at`. */
const renderers = (at: string): Record<string, string> => ({
    [`${at}/render-json.ts`]: '',
    [`${at}/render-text.ts`]: '',
    [`${at}/render-sarif.ts`]: '',
    [`${at}/render-pr.ts`]: '',
    [`${at}/main.ts`]: '',
});

const json = (ran: Ran): { summary: { filesChecked: number }; findings: { folder: string; rule: string }[] } =>
    JSON.parse(ran.out) as { summary: { filesChecked: number }; findings: { folder: string; rule: string }[] };

describe('checking some folders', () => {
    // Point 1 (Irina, Óscar, Daniel), and the recipe docs/ci.md gave.
    it('evaluates and prunes only the suppressions of the folders given', async () => {
        const root = repository({ ...renderers('src'), ...renderers('src/lib') });
        assert.equal((await cli(root, ['--suppress-all'])).code, 0);
        const before = readJson(root);

        const lib = await cli(root, ['src/lib']);
        assert.equal(lib.code, 0, lib.out);
        assert.doesNotMatch(lib.out, /fixed|nothing needs/u);

        assert.equal((await cli(root, ['src/lib', '--prune-suppressions'])).code, 0);
        assert.deepEqual(readJson(root), before);
        assert.equal((await cli(root, [])).code, 0);
    });
});

describe('suppressions', () => {
    // Point 23 (Marta): say what was written.
    it('says what --suppress-all and --prune-suppressions wrote', async () => {
        const root = repository({ ...renderers('cli'), ...renderers('lib') });
        const added = await cli(root, ['--suppress-all']);
        assert.match(
            added.err,
            /Wrote crowded-folders-suppressions\.json: added 2; it holds 2 suppressions in 2 folders\. Commit it\.\n {2}\+ cli {2}prefix-groups#render {2}at 4\n/u,
        );
        rmSync(join(root, 'cli/render-pr.ts'));
        rmSync(join(root, 'lib/render-pr.ts'));
        rmSync(join(root, 'lib/render-sarif.ts'));
        const pruned = await cli(root, ['--prune-suppressions']);
        assert.match(pruned.err, /Pruned crowded-folders-suppressions\.json: removed 2; it holds 0 suppressions/u);
        assert.match(pruned.err, /− cli {2}prefix-groups#render {2}\(was 4\)/u);
        assert.match((await cli(root, ['--prune-suppressions'])).err, /Nothing to prune/u);
    });

    it('refuses --prune-suppressions and --suppress-all when no rule is on ({}), and reports nothing as fixed', async () => {
        const root = repository({ ...renderers('cli'), ...renderers('lib') });
        assert.equal((await cli(root, ['--suppress-all'])).code, 0);
        const before = readJson(root);
        writeFileSync(join(root, 'crowded-folders.config.json'), '{}');
        for (const flag of ['--prune-suppressions', '--suppress-all']) {
            const ran = await cli(root, [flag]);
            assert.equal(ran.code, 2, ran.err);
            assert.match(ran.err, new RegExp(`${flag}: no rule is on`, 'u'));
        }
        assert.deepEqual(readJson(root), before);
        const checked = await cli(root, []);
        assert.equal(checked.code, 0, checked.err);
        assert.doesNotMatch(checked.out, /fixed|prune/iu);
    });

    // Point 22 (Marta): good news in green, with the command that saves it.
    it('shows a folder that went down as progress, and the summary says the run fails until it is saved', async () => {
        const root = repository({
            ...renderers('cli'),
            'cli/render-md.ts': '',
            'crowded-folders.config.json': '{ "extends": ["recommended"] }',
        });
        await cli(root, ['--suppress-all']);
        rmSync(join(root, 'cli/render-md.ts'));
        const ran = await cli(root, []);
        assert.equal(ran.code, 1);
        assert.match(
            ran.out,
            /Progress\n {2}down cli {2}prefix-groups#render {2}5 to 4\n {2}Save it with --prune-suppressions/u,
        );
        assert.doesNotMatch(ran.out, /nothing needs/u);
        // Point 118 (Marta, Óscar, Irina): never a OK on a run that exits with 1.
        assert.match(ran.out, /FAIL 1 suppression to prune \(/u);
        assert.doesNotMatch(ran.out, /OK No crowded folders/u);
    });

    // Point 21 (Daniel), through the command.
    it('keeps the notes a person wrote next to a count', async () => {
        const root = repository({ ...renderers('cli'), 'cli/render-md.ts': '' });
        writeFileSync(
            join(root, SUPPRESSIONS),
            JSON.stringify({
                version: 1,
                suppressions: { 'cli/': { 'prefix-groups#render': { count: 6, reason: 'until v2', owner: '@cli' } } },
            }),
        );
        assert.equal((await cli(root, ['--prune-suppressions'])).code, 0);
        assert.deepEqual(readJson(root), {
            version: 1,
            suppressions: { cli: { 'prefix-groups#render': { count: 5, reason: 'until v2', owner: '@cli' } } },
        });
    });

    // Point 20 (Irina): an unknown rule says so; a key with a trailing slash suppresses its folder.
    it('says "is not a rule" instead of "fixed"', async () => {
        const root = repository(renderers('cli'));
        writeFileSync(
            join(root, SUPPRESSIONS),
            JSON.stringify({
                version: 1,
                suppressions: { 'cli/': { 'prefix-groups#render': { count: 4 }, 'no-such-rule': { count: 2 } } },
            }),
        );
        const ran = await cli(root, []);
        assert.equal(ran.code, 1);
        assert.match(ran.out, /stale cli {2}no-such-rule {2}\(suppressed at 2; "no-such-rule" is not a rule\)/u);
        assert.match(ran.out, /1 problem suppressed/u);
    });

    // Point 18 (Tomás): a renamed folder.
    it('says a suppressed folder that was renamed looks moved', async () => {
        const root = repository(renderers('src/widgets'));
        await cli(root, ['--suppress-all']);
        renameSync(join(root, 'src/widgets'), join(root, 'src/components'));
        const ran = await cli(root, []);
        assert.equal(ran.code, 1);
        assert.match(ran.out, /Looks moved from src\/widgets, where it was suppressed at 4/u);
        assert.match(
            ran.out,
            /src\/widgets {2}prefix-groups#render {2}\(suppressed at 4; looks moved to src\/components/u,
        );
    });

    // Point 24 (Óscar): writing suppressions in CI leaves no trace.
    it('refuses to write suppressions in CI without --force', async () => {
        const root = repository(renderers('cli'));
        for (const flag of ['--suppress-all', '--prune-suppressions']) {
            // --no-git: the fixture is not a repository, and with CI set git's list is required.
            const ran = await cli(root, [flag, '--no-git'], { CI: 'true' });
            assert.equal(ran.code, 2, flag);
            assert.match(ran.err, new RegExp(`${flag} writes the suppressions file, and this run is in CI`, 'u'));
        }
        assert.equal((await cli(root, ['--suppress-all', '--force', '--no-git'], { CI: 'true' })).code, 0);
        // Azure Pipelines sets TF_BUILD, not CI.
        const azure = await cli(root, ['--prune-suppressions', '--no-git'], { TF_BUILD: 'True' });
        assert.equal(azure.code, 2);
        assert.match(azure.err, /this run is in CI \(TF_BUILD=True\)/u);
        assert.equal((await cli(root, ['--suppress-all'], { CI: 'false' })).code, 0);
    });

    // Point 27 (Daniel, Óscar): what the tool writes is not counted.
    it('never counts the suppressions file or the --output file as files checked', async () => {
        const root = repository(renderers('cli'));
        const before = json(await cli(root, ['--format', 'json'])).summary.filesChecked;
        await cli(root, ['--suppress-all']);
        for (let time = 0; time < 2; time++) {
            assert.equal((await cli(root, ['--format', 'json', '--output', 'report.json'])).code, 0);
            const report = readJson(root, 'report.json') as { summary: { filesChecked: number } };
            assert.equal(report.summary.filesChecked, before);
        }
        // Nor any of the reports of a run that writes several.
        const other = repository(renderers('cli'));
        for (let time = 0; time < 2; time++) {
            await cli(other, ['-f', 'json=a.json', '-f', 'sarif=b.sarif', '-f', 'markdown=c.md']);
            const report = readJson(other, 'a.json') as { summary: { filesChecked: number } };
            assert.equal(report.summary.filesChecked, before);
        }
    });

    // Point 25 (Daniel): one file per package.
    it('keeps one suppressions file per project with "per-project"', async () => {
        const root = repository({
            'crowded-folders.config.json': '{ "extends": ["recommended"], "suppressions": "per-project" }',
            'package.json': '{}',
            'packages/web/package.json': '{}',
            ...renderers('packages/web/src'),
            ...renderers('tools'),
        });
        const ran = await cli(root, ['--suppress-all']);
        assert.equal(ran.code, 0, ran.out + ran.err);
        assert.deepEqual(readJson(root, `packages/web/${SUPPRESSIONS}`), {
            version: 1,
            suppressions: { src: { 'prefix-groups#render': { count: 4 } } },
        });
        assert.deepEqual(readJson(root), {
            version: 1,
            suppressions: { tools: { 'prefix-groups#render': { count: 4 } } },
        });
        assert.equal((await cli(root, [])).code, 0);
        writeFileSync(join(root, 'packages/web/src/render-md.ts'), '');
        assert.match((await cli(root, [])).out, /packages\/web\/src\/\n.*it has grown/u);
    });
});

describe('the summary follows the exit code', () => {
    // Point 118: -q --max-warnings 0 said "OK No crowded folders" and exited with 1.
    it('with --quiet and --max-warnings', async () => {
        const root = repository({
            ...renderers('cli'),
            'crowded-folders.config.json': '{ "rules": { "prefix-groups": "warn" } }',
        });
        const ran = await cli(root, ['-q', '--max-warnings', '0']);
        assert.equal(ran.code, 1);
        assert.match(ran.out, /^FAIL 1 warning \(1 hidden by --quiet\), over --max-warnings 0 \(/mu);
        const loud = await cli(root, ['--max-warnings', '0']);
        assert.match(loud.out, /FAIL 0 errors, 1 warning in 1 folder, over --max-warnings 0 \(/u);
        assert.match((await cli(root, [])).out, /WARN 0 errors, 1 warning in 1 folder/u);
    });
});

describe('comparing with a base', () => {
    // Point 26 (Óscar): adopting without a suppressions file.
    it('--new-since fails only on what is new or grew, also in a clone of depth 1', async () => {
        const origin = gitRepository({ ...renderers('old'), 'a.ts': '' });
        git(origin, 'checkout', '-q', '-b', 'feature');
        write(origin, { ...renderers('fresh') });
        git(origin, 'add', '-A');
        git(origin, 'commit', '-q', '-m', 'feature');

        const clone = folder();
        execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'feature', pathToFileURL(origin).href, clone], {
            stdio: 'ignore',
        });
        // A clone of one branch: a bare `git fetch origin main` would only set FETCH_HEAD.
        git(clone, 'fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main');

        const ran = await cli(clone, ['--new-since', 'origin/main', '--format', 'json']);
        assert.equal(ran.code, 1, ran.err);
        assert.deepEqual(
            json(ran).findings.map(finding => finding.folder),
            ['fresh'],
        );
        assert.match(ran.err, /no merge base with HEAD \(a shallow clone\?\)/u);
        const text = await cli(clone, ['--new-since', 'origin/main']);
        assert.match(text.out, /1 problem already on origin\/main/u);

        // The machine formats say it too, and the annotations go on the files the change added.
        const machine = await cli(clone, ['--new-since', 'origin/main', '-f', 'json', '-f', 'sarif=out.sarif']);
        assert.deepEqual((JSON.parse(machine.out) as { knownOnBase: unknown }).knownOnBase, {
            label: 'origin/main',
            count: 1,
        });
        const sarif = readJson(clone, 'out.sarif') as {
            runs: { properties: { knownOnBase: unknown } }[];
        };
        assert.deepEqual(sarif.runs[0]?.properties.knownOnBase, { label: 'origin/main', count: 1 });
        const github = await cli(clone, ['--new-since', 'origin/main', '-f', 'github']);
        assert.match(github.out, /^::error file=fresh\/render-\w+\.ts,/mu);

        write(clone, { 'old/render-md.ts': '' });
        assert.match((await cli(clone, ['--new-since', 'origin/main'])).out, /4 on origin\/main; it has grown/u);
        assert.equal((await cli(clone, ['--new-since', 'nope/nothing'])).code, 2);
    });

    // The root inside the configuration's folder: git lists the base from the root, the report's
    // paths start at the configuration, and the two must meet.
    it('--new-since and --since with --root inside the configuration folder', async () => {
        const root = gitRepository({
            'crowded-folders.config.json': '{ "extends": ["recommended"] }',
            ...renderers('pkg/old'),
            ...renderers('other/old'),
        });
        git(root, 'checkout', '-q', '-b', 'feature');
        write(root, { ...renderers('pkg/fresh'), ...renderers('other/fresh') });

        const newSince = await cli(root, ['--root', 'pkg', '--new-since', 'main', '--format', 'json']);
        assert.deepEqual(
            json(newSince).findings.map(finding => finding.folder),
            ['pkg/fresh'],
        );
        const since = await cli(root, ['--root', 'pkg', '--since', 'main', '--format', 'json']);
        assert.deepEqual(
            json(since).findings.map(finding => finding.folder),
            ['pkg/fresh'],
        );
    });

    // Point 214: only the folders a change reshaped, and never the suppressions of the others.
    it('--since checks the folders a file was added to, removed from or moved between', async () => {
        const root = gitRepository({ ...renderers('kept'), ...renderers('src/widgets'), 'other/a.ts': '' });
        await cli(root, ['--suppress-all']);
        git(root, 'add', '-A');
        git(root, 'commit', '-q', '-m', 'adopt');
        git(root, 'checkout', '-q', '-b', 'feature');
        git(root, 'mv', 'src/widgets', 'src/components');
        write(root, { 'kept/main.ts': 'edited in place: no new shape' });

        const ran = await cli(root, ['--since', 'main', '--format', 'json']);
        assert.equal(ran.code, 1);
        assert.deepEqual(
            json(ran).findings.map(finding => finding.folder),
            ['src/components'],
        );
        assert.match(ran.err, /--since main: 3 folders reshaped \(5 files added, 5 removed\)/u);
        const text = await cli(root, ['--since', 'main']);
        assert.doesNotMatch(text.out, /kept/u);
        assert.match(text.out, /looks moved to src\/components/u);

        // --prune-suppressions removes the one of the folder that went, and nothing else.
        assert.equal((await cli(root, ['--since', 'main', '--prune-suppressions'])).code, 1);
        assert.deepEqual(readJson(root), {
            version: 1,
            suppressions: { kept: { 'prefix-groups#render': { count: 4 } } },
        });
    });

    it('--changed reads the base from the CI, and outside a pull request checks everything', async () => {
        const root = gitRepository({ ...renderers('kept') });
        git(root, 'checkout', '-q', '-b', 'feature');
        write(root, { ...renderers('fresh') });

        const github = await cli(root, ['--changed', '--format', 'json'], { GITHUB_BASE_REF: 'main' });
        assert.deepEqual(
            json(github).findings.map(finding => finding.folder),
            ['fresh'],
        );
        const gitlab = await cli(root, ['--changed', '--format', 'json'], {
            CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
        });
        assert.deepEqual(
            json(gitlab).findings.map(finding => finding.folder),
            ['fresh'],
        );
        const push = await cli(root, ['--changed', '--format', 'json']);
        assert.match(push.err, /no pull-request base in the environment/u);
        assert.deepEqual(
            json(push).findings.map(finding => finding.folder),
            ['fresh', 'kept'],
        );
        const missing = await cli(root, ['--changed'], { GITHUB_BASE_REF: 'nowhere' });
        assert.equal(missing.code, 2);
        assert.match(missing.err, /git knows none of origin\/nowhere \(GITHUB_BASE_REF\), nowhere/u);
        assert.equal((await cli(root, ['--since', 'main', '--changed'])).code, 2);
        assert.equal((await cli(root, ['--since', 'main', 'src'])).code, 2);
    });
});

describe('ciBaseOf', () => {
    it('reads the base of a pull request from the CI it runs in', () => {
        assert.deepEqual(ciBaseOf({}), []);
        assert.deepEqual(ciBaseOf({ GITHUB_BASE_REF: 'main' })[0]?.refs, ['origin/main', 'main']);
        assert.deepEqual(ciBaseOf({ GITHUB_BASE_REF: '' }), []);
        assert.deepEqual(ciBaseOf({ SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/develop' })[0]?.refs, [
            'origin/develop',
            'develop',
        ]);
        assert.deepEqual(
            ciBaseOf({ CI_MERGE_REQUEST_DIFF_BASE_SHA: 'abc123', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' }).map(
                base => base.refs,
            ),
            [['abc123'], ['origin/main', 'main']],
        );
    });
});
