import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { satisfies } from './version-range.ts';

describe('satisfies', () => {
    const cases: readonly (readonly [string, string, boolean | undefined])[] = [
        ['1.0.0', '^1.0.0', true],
        ['1.4.2', '^1.0.0', true],
        ['2.0.0', '^1.0.0', false],
        ['0.9.0', '^1.0.0', false],
        ['0.2.5', '^0.2.3', true],
        ['0.3.0', '^0.2.3', false],
        ['0.0.4', '^0.0.3', false],
        ['1.2.9', '~1.2.3', true],
        ['1.3.0', '~1.2.3', false],
        ['1.9.0', '~1', true],
        ['1.0.0', '>=1 <3', true],
        ['3.0.0', '>=1 <3', false],
        ['1.0.0', '>= 1.0.0', true],
        ['1.5.0', '1.x', true],
        ['2.0.0', '1.x', false],
        ['1.0.0', '1.0.0', true],
        ['1.0.1', '1.0.0', false],
        ['2.5.0', '1 - 2', true],
        ['3.0.0', '1 - 2', false],
        ['2.0.0', '^1.0.0 || ^2.0.0', true],
        ['1.0.0', '*', true],
        ['1.0.0', '', true],
        ['1.0.0', '>1', false],
        ['2.0.0', '>1', true],
        ['1.2.0', '<=1.2', true],
        ['1.3.0', '<=1.2', false],
        ['1.0.0', '<1.0.0', false],
        ['1.0.0', 'workspace:*', undefined],
        ['1.0.0', 'github:acme/x', undefined],
    ];
    for (const [version, range, expected] of cases) {
        it(`${version} in "${range}" is ${String(expected)}`, () => {
            assert.equal(satisfies(version, range), expected);
        });
    }
});
