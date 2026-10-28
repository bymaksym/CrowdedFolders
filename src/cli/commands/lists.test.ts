import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const names = (out: string): string[] => out.split('\n').filter(line => /^[a-z]/u.test(line) && !line.includes(' '));

describe('presets and rules', () => {
    it('filter by the name typed, in any case', async () => {
        const root = repository({});
        const react = await cli(root, ['presets', 'React']);
        assert.equal(react.code, 0, react.err);
        assert.ok(
            names(react.out).every(name => name.includes('react')),
            react.out,
        );
        assert.ok(names(react.out).includes('react'));
        const all = await cli(root, ['presets']);
        assert.ok(names(all.out).length > names(react.out).length);
        assert.deepEqual(names((await cli(root, ['rules', 'max-files'])).out), ['max-files']);
        assert.ok(names((await cli(root, ['rules', 'max'])).out).length >= 2);
    });

    it('say when nothing matches, with the closest name', async () => {
        const root = repository({});
        const ran = await cli(root, ['presets', 'reakt']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /no preset matches "reakt"; did you mean react\?/u);
        assert.match((await cli(root, ['rules', 'zzzz'])).err, /no rule matches "zzzz"/u);
        assert.match((await cli(root, ['rules', 'a', 'b'])).err, /rules takes one name to filter by/u);
    });

    it('wrap what they say, so that no line but a link is long', async () => {
        const root = repository({});
        for (const command of ['presets', 'rules']) {
            for (const line of (await cli(root, [command])).out.split('\n')) {
                assert.ok(
                    line.length <= 100 || line.includes('https://'),
                    `${command}: ${line.length} columns: ${line}`,
                );
            }
        }
    });
});
