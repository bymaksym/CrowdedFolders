import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from './test-support/harness.ts';

cleanUpAfterTests();

function git(root: string, ...args: string[]): void {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

/** A repository with two tracked files, and one a previous CI step left behind. */
function checkout(): string {
    const root = repository({ 'src/a.ts': '', 'src/b.ts': '' });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    mkdirSync(join(root, 'test-results'));
    writeFileSync(join(root, 'test-results', 'report.xml'), '');
    return root;
}

const countOf = (out: string): string => /(\d+) files? checked/u.exec(out)?.[1] ?? out;

describe('--tracked-only', () => {
    it('counts only the files git tracks; without it, the untracked ones count', async () => {
        const root = checkout();
        assert.equal(countOf((await cli(root, ['--no-color'])).out), '3');
        assert.equal(countOf((await cli(root, ['--tracked-only', '--no-color'])).out), '2');
    });

    it('is on by default on CI (a test-results/ folder from an earlier step is not the repository), and --no-tracked-only turns it off', async () => {
        const root = checkout();
        assert.equal(countOf((await cli(root, ['--no-color'], { CI: 'true' })).out), '2');
        assert.equal(countOf((await cli(root, ['--no-color', '--no-tracked-only'], { CI: 'true' })).out), '3');
    });

    it('cannot be asked for without git', async () => {
        const root = checkout();
        for (const other of ['--no-git', '--stdin']) {
            const ran = await cli(root, ['--tracked-only', other]);
            assert.equal(ran.code, 2);
            assert.match(ran.err, /--tracked-only and --(no-git|stdin) cannot both be given/u);
        }
        assert.match((await cli(root, ['--tracked-only', '--no-tracked-only'])).err, /cannot both be given/u);
    });
});
