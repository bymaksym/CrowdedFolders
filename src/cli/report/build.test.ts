import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

function git(root: string, ...args: string[]): void {
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
            ...args,
        ],
        { stdio: 'ignore' },
    );
}

const modules = (count: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`src/widgets/w${index}.ts`, '']));

describe('annotations with a base', () => {
    it('say how much the change adds to a folder over its limit: "this change adds 1 (20→21)"', async () => {
        const root = repository({ ...modules(20), 'crowded-folders.config.json': '{"extends":["recommended"]}' });
        git(root, 'init', '-q', '-b', 'main');
        git(root, 'add', '-A');
        git(root, 'commit', '-q', '-m', 'base');
        git(root, 'checkout', '-q', '-b', 'feature');
        writeFileSync(join(root, 'src/widgets/w20.ts'), '');
        const ran = await cli(root, ['--format', 'github', '--base', 'main']);
        assert.equal(ran.code, 1, ran.out);
        assert.match(ran.out, /file=src\/widgets\/w20\.ts/u);
        assert.match(ran.out, /This change adds 1 \(20→21\)\./u);
        // Without a base there is nothing to compare with, and nothing to claim.
        assert.doesNotMatch((await cli(root, ['--format', 'github'])).out, /This change adds/u);
    });
});
