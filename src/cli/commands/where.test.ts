import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const CONFIG = JSON.stringify({
    rules: { 'max-files': ['error', { max: 3 }], 'prefix-groups': ['warn', { min: 4 }] },
});

function drawer(): string {
    return repository({
        'crowded-folders.config.json': CONFIG,
        'core/enums/a.enum.ts': '',
        'core/enums/b.enum.ts': '',
        'core/enums/c.enum.ts': '',
        'core/layout/navbar/navbar.component.ts': '',
        'core/layout/header.component.ts': '',
    });
}

describe('crowded-folders where', () => {
    it('says CREATES or WORSE with the numbers, and OK with the folder that exists', async () => {
        const root = drawer();
        const ran = await cli(root, [
            'where',
            'core/enums/foo-bar.enum.ts',
            'core/layout/navbar-mobile.component.ts',
            'core/layout/footer.component.ts',
        ]);
        assert.equal(ran.code, 0, ran.err);
        const firstTwoLines = (block: string): string => block.split('\n').slice(0, 2).join(' | ');
        assert.deepEqual(ran.out.trimEnd().split('\n\n').map(firstTwoLines), [
            'core/enums/foo-bar.enum.ts |   CREATES max-files 4 (limit 3)',
            'core/layout/navbar-mobile.component.ts |   OK, and core/layout/navbar/ exists',
            'core/layout/footer.component.ts |   OK',
        ]);
    });

    it('is exit 0 unless --fail-on worse asks, then 1 only for a file that makes a folder worse', async () => {
        const root = drawer();
        assert.equal((await cli(root, ['where', 'core/enums/foo.enum.ts'])).code, 0);
        assert.equal((await cli(root, ['where', '--fail-on', 'worse', 'core/enums/foo.enum.ts'])).code, 1);
        assert.equal((await cli(root, ['where', '--fail-on', 'worse', 'core/layout/footer.ts'])).code, 0);
        const bad = await cli(root, ['where', '--fail-on', 'sometimes', 'a.ts']);
        assert.equal(bad.code, 2);
        assert.match(bad.err, /--fail-on must be worse/u);
    });

    it('prints JSON with -f json: the effect, the findings before and after and the candidates', async () => {
        const root = drawer();
        const ran = await cli(root, ['where', '-f', 'json', 'core/enums/foo.enum.ts', 'core/layout/navbar-x.ts']);
        const { version, results } = JSON.parse(ran.out) as {
            version: number;
            results: {
                path: string;
                effect: string;
                changes: {
                    rule: string;
                    change: string;
                    before?: number;
                    after: number;
                    limit: number;
                    message: string;
                }[];
                candidates: { folder: string; kind: string; reason: string }[];
            }[];
        };
        assert.equal(version, 1);
        assert.deepEqual(
            results.map(result => [result.path, result.effect]),
            [
                ['core/enums/foo.enum.ts', 'creates'],
                ['core/layout/navbar-x.ts', 'neutral'],
            ],
        );
        assert.deepEqual(
            results[0]?.changes.map(({ message, ...change }) => ({ ...change, message: message.length > 0 })),
            [
                {
                    change: 'new',
                    rule: 'max-files',
                    severity: 'error',
                    folder: 'core/enums',
                    after: 4,
                    limit: 3,
                    moves: [],
                    message: true,
                },
            ],
        );
        assert.deepEqual(
            results[1]?.candidates.map(({ reason, ...candidate }) => ({
                ...candidate,
                reason: reason.includes('navbar'),
            })),
            [{ folder: 'core/layout/navbar', kind: 'folder', reason: true }],
        );
    });

    it('takes paths from where it was typed, absolute ones, and files that exist or are outside', async () => {
        const root = drawer();
        const inside = await cli(join(root, 'core', 'enums'), ['where', 'foo.enum.ts']);
        assert.match(inside.out, /^core\/enums\/foo\.enum\.ts\n {2}CREATES/u);
        const absolute = await cli(root, ['where', join(root, 'core', 'enums', 'a.enum.ts')]);
        assert.match(absolute.out, /\n {2}EXISTS/u);
        const outside = await cli(join(root, 'core'), ['where', '../../x.ts']);
        assert.equal(outside.code, 2);
        assert.match(outside.err, /is outside the folder being checked/u);
        const folder = await cli(root, ['where', 'core/enums']);
        assert.equal(folder.code, 2);
        assert.match(folder.err, /core\/enums is a folder: give the path of the file to add/u);
        const none = await cli(root, ['where']);
        assert.match(none.err, /where takes the path of a new file/u);
    });

    it('answers for a root that is a project inside the repository, with the paths of the report', async () => {
        const root = repository({
            'crowded-folders.config.json': CONFIG,
            'a/x.ts': '',
            'a/y.ts': '',
            'a/z.ts': '',
        });
        const ran = await cli(root, ['where', '--format', 'json', 'a/w.ts']);
        const [result] = (JSON.parse(ran.out) as { results: { folder: string; effect: string }[] }).results;
        assert.deepEqual([result?.folder, result?.effect], ['a', 'creates']);
    });
});
