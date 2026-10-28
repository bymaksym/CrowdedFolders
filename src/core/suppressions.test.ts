import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Finding } from './engine.ts';
import {
    addSuppressions,
    applySuppressions,
    parseSuppressions,
    projectOf,
    pruneSuppressions,
    serialiseSuppressions,
    type Suppression,
    type SuppressionContext,
    suppressionId,
} from './suppressions.ts';

const FILE = 'crowded-folders-suppressions.json';

const finding = (
    folder: string,
    rule: string,
    measured: number,
    key?: string,
    severity: 'error' | 'warn' = 'error',
): Finding => ({
    rule,
    severity,
    folder,
    message: `${rule} in ${folder}`,
    key,
    measured,
    limit: undefined,
    files: [],
    moves: [],
    url: undefined,
});

const RULES = new Set(['max-files', 'prefix-groups', 'max-folders']);

/** A context where the folders that exist are the ones given. */
function context(folders: readonly string[], extra: Partial<SuppressionContext> = {}): SuppressionContext {
    const set = new Set(['.', ...folders]);
    return { folderExists: folder => set.has(folder), folders: () => set, rules: RULES, ...extra };
}

const toRoot = { fileFor: (): string => FILE };

/** The `suppressions` object of the file as it would be written. */
const written = (list: readonly Suppression[], base?: string): unknown =>
    (JSON.parse(serialiseSuppressions(list, base)) as { suppressions: unknown }).suppressions;

/** Reads a file the way the command does: JSON text, as it is on disk. */
function read(text: string, base = '.', file = FILE): Suppression[] {
    const parsed = parseSuppressions(JSON.parse(text), { file, base });
    assert.ok(Array.isArray(parsed), typeof parsed === 'string' ? parsed : '');
    return parsed;
}

describe('suppressions', () => {
    const today = [
        finding('src', 'max-files', 30),
        finding('cli', 'prefix-groups', 5, 'render'),
        finding('a', 'max-files', 25, undefined, 'warn'),
    ];
    const here = context(['src', 'cli', 'a']);

    it('records errors only, with the number measured, sorted, and says what it added', () => {
        const edit = addSuppressions([], today, toRoot);
        assert.deepEqual(JSON.parse(serialiseSuppressions(edit.suppressions)), {
            version: 1,
            suppressions: { cli: { 'prefix-groups#render': { count: 5 } }, src: { 'max-files': { count: 30 } } },
        });
        assert.deepEqual(
            edit.changes.map(change => [change.kind, change.folder, change.id, change.to]),
            [
                ['added', 'cli', 'prefix-groups#render', 5],
                ['added', 'src', 'max-files', 30],
            ],
        );
        assert.deepEqual(
            addSuppressions([], today, { ...toRoot, rules: ['max-files'] }).suppressions.map(entry => entry.folder),
            ['src'],
        );
        assert.equal(suppressionId(today[1] ?? finding('', '', 0)), 'prefix-groups#render');
    });

    it('lets a suppressed problem stay or shrink, but reports it when it grows', () => {
        const file = addSuppressions([], today, toRoot).suppressions;
        const same = applySuppressions(today, file, here);
        assert.equal(same.suppressed.length, 2);
        assert.equal(same.kept.length, 1);
        assert.deepEqual(same.stale, []);

        const grown = applySuppressions([finding('src', 'max-files', 31)], file, here);
        assert.equal(grown.kept.length, 1);
        assert.match(grown.kept[0]?.message ?? '', /Suppressed at 30; it has grown/u);
    });

    it('calls stale what is fixed or lower than remembered, and pruning lowers and removes it, saying so', () => {
        const file = addSuppressions([], today, toRoot).suppressions;
        const later = [finding('src', 'max-files', 28)];
        const outcome = applySuppressions(later, file, here);
        assert.deepEqual(
            outcome.stale.map(stale => [stale.folder, stale.id, stale.count, stale.measured, stale.status]),
            [
                ['cli', 'prefix-groups#render', 5, undefined, 'fixed'],
                ['src', 'max-files', 30, 28, 'lowered'],
            ],
        );
        assert.equal(outcome.stale[0]?.key, 'render');
        assert.equal(outcome.stale[0]?.rule, 'prefix-groups');
        assert.equal(outcome.stale[0]?.file, FILE);
        const pruned = pruneSuppressions(file, later);
        assert.deepEqual(written(pruned.suppressions), {
            src: { 'max-files': { count: 28 } },
        });
        assert.deepEqual(
            pruned.changes.map(change => [change.kind, change.folder, change.from, change.to]),
            [
                ['removed', 'cli', 5, undefined],
                ['lowered', 'src', 30, 28],
            ],
        );
        assert.deepEqual(applySuppressions(later, pruned.suppressions, here).stale, []);
    });

    it('never suppresses a configuration warning', () => {
        const stale = finding('.', 'config/unused-override', 1, 'x');
        assert.deepEqual(addSuppressions([], [stale], toRoot).suppressions, []);
    });

    it('reads back what it writes, and explains a file it cannot read', () => {
        const file = addSuppressions([], today, toRoot).suppressions;
        assert.deepEqual(read(serialiseSuppressions(file)), file);
        const where = { file: FILE, base: '.' };
        assert.match(parseSuppressions({ version: 2 }, where) as string, /not a crowded-folders suppressions file/u);
        assert.match(
            parseSuppressions({ version: 1, suppressions: { a: { b: { count: -1 } } } }, where) as string,
            /without a whole "count"/u,
        );
        assert.match(parseSuppressions({ version: 1, suppressions: { a: 3 } }, where) as string, /not an object/u);
        assert.match(
            parseSuppressions({ version: 1, suppressions: { '../up': { b: { count: 1 } } } }, where) as string,
            /outside the folder/u,
        );
    });

    // Irina, Óscar, Daniel: after --suppress-all, `crowded-folders src/lib` said
    // "src prefix-groups#render (suppressed at 4, fixed)" and failed, and with --prune-suppressions
    // left only src/lib in the file. That is the recipe docs/ci.md gives.
    it('looks only at the suppressions of the folders checked, and prunes nothing else', () => {
        const file = read(
            JSON.stringify({
                version: 1,
                suppressions: {
                    src: { 'prefix-groups#render': { count: 4 } },
                    'src/lib': { 'max-files': { count: 25 } },
                },
            }),
        );
        const inScope = (folder: string): boolean => folder === 'src/lib' || folder.startsWith('src/lib/');
        const onlyLib = [finding('src/lib', 'max-files', 25)];
        const outcome = applySuppressions(onlyLib, file, context(['src', 'src/lib'], { inScope }));
        assert.deepEqual(outcome.stale, []);
        assert.equal(outcome.suppressed.length, 1);

        const pruned = pruneSuppressions(file, onlyLib, { inScope });
        assert.deepEqual(pruned.changes, []);
        assert.deepEqual(written(pruned.suppressions), {
            src: { 'prefix-groups#render': { count: 4 } },
            'src/lib': { 'max-files': { count: 25 } },
        });
    });

    // Tomás: `mv src/widgets src/components` after --suppress-all gave
    // "src/widgets max-files (suppressed at 26, fixed)" and two new errors.
    it('says a suppression of a folder that is gone looks moved to the new folder with the same problem', () => {
        const file = read(
            JSON.stringify({ version: 1, suppressions: { 'src/widgets': { 'max-files': { count: 26 } } } }),
        );
        const outcome = applySuppressions(
            [finding('src/components', 'max-files', 26)],
            file,
            context(['src', 'src/components']),
        );
        assert.equal(outcome.stale[0]?.status, 'moved');
        assert.equal(outcome.stale[0]?.movedTo, 'src/components');
        assert.match(outcome.kept[0]?.message ?? '', /Looks moved from src\/widgets, where it was suppressed at 26/u);

        // With the evidence of a rename, the number may differ; without it, it must be the same.
        const grew = [finding('src/components', 'max-files', 27)];
        assert.equal(applySuppressions(grew, file, context(['src/components'])).stale[0]?.status, 'missing-folder');
        assert.equal(
            applySuppressions(
                grew,
                file,
                context(['src/components'], { renamed: new Map([['src/widgets', 'src/components']]) }),
            ).stale[0]?.movedTo,
            'src/components',
        );
    });

    // Irina: `"__proto__": {"max-files": {"count": 99}}` silenced max-files in another folder, and
    // with those folders in the list --suppress-all said 4 problems suppressed and wrote 2.
    it('treats __proto__ and constructor as folders like any other', () => {
        const polluted = read('{ "version": 1, "suppressions": { "__proto__": { "max-files": { "count": 99 } } } }');
        assert.equal(polluted[0]?.folder, '__proto__');
        const elsewhere = applySuppressions([finding('src', 'max-files', 30)], polluted, context(['src', '__proto__']));
        assert.equal(elsewhere.kept.length, 1);
        assert.equal(elsewhere.suppressed.length, 0);

        const odd = ['__proto__', 'constructor', 'src/__proto__', 'toString'].map(folder =>
            finding(folder, 'max-files', 30),
        );
        const added = addSuppressions([], odd, toRoot).suppressions;
        assert.equal(added.length, 4);
        const back = read(serialiseSuppressions(added));
        assert.deepEqual(
            back.map(entry => entry.folder),
            ['__proto__', 'constructor', 'src/__proto__', 'toString'],
        );
        assert.equal(applySuppressions(odd, back, context(odd.map(entry => entry.folder))).suppressed.length, 4);
        assert.equal(({} as Record<string, unknown>)['max-files'], undefined);
    });

    // Irina: "no-such-rule" or "src/lib/" (a trailing slash) gave "suppressed at N, fixed" while the
    // real error went on being reported.
    it('normalises folder keys and says when a rule or a folder does not exist', () => {
        const file = read(
            JSON.stringify({
                version: 1,
                suppressions: {
                    'src/lib/': { 'max-files': { count: 25 } },
                    src: { 'no-such-rule': { count: 3 } },
                    'SRC/Gone': { 'max-files': { count: 3 } },
                },
            }),
        );
        assert.deepEqual(
            file.map(entry => entry.folder),
            ['SRC/Gone', 'src', 'src/lib'],
        );
        const outcome = applySuppressions(
            [finding('src/lib', 'max-files', 25)],
            file,
            context(['src', 'src/lib', 'src/gone']),
        );
        assert.equal(outcome.suppressed.length, 1);
        assert.deepEqual(
            outcome.stale.map(stale => [stale.folder, stale.status, stale.didYouMean]),
            [
                ['SRC/Gone', 'missing-folder', 'src/gone'],
                ['src', 'unknown-rule', undefined],
            ],
        );
        assert.match(
            parseSuppressions(
                {
                    version: 1,
                    suppressions: {
                        'src/lib': { 'max-files': { count: 1 } },
                        './src/lib/': { 'max-files': { count: 2 } },
                    },
                },
                { file: FILE, base: '.' },
            ) as string,
            /twice for one folder, as "src\/lib" and "\.\/src\/lib\/"/u,
        );
    });

    // Daniel: a suppression with "reason", "owner" or "expires" was accepted, and
    // --prune-suppressions wrote it back without them.
    it('keeps reason, owner and expires through pruning and adding, and rejects other fields', () => {
        const file = read(
            JSON.stringify({
                version: 1,
                suppressions: {
                    src: {
                        'max-files': {
                            count: 30,
                            reason: 'split after the 2.0 release',
                            owner: '@web',
                            expires: '2027-01-31',
                        },
                    },
                },
            }),
        );
        const pruned = pruneSuppressions(file, [finding('src', 'max-files', 28)]).suppressions;
        const raised = addSuppressions(pruned, [finding('src', 'max-files', 29)], toRoot).suppressions;
        assert.deepEqual(written(raised), {
            src: {
                'max-files': { count: 29, reason: 'split after the 2.0 release', owner: '@web', expires: '2027-01-31' },
            },
        });
        const where = { file: FILE, base: '.' };
        assert.match(
            parseSuppressions({ version: 1, suppressions: { a: { b: { count: 1, ticket: 'X-1' } } } }, where) as string,
            /"ticket", which is not a field of a suppression \(count, reason, owner, expires\)/u,
        );
        assert.match(
            parseSuppressions(
                { version: 1, suppressions: { a: { b: { count: 1, expires: 'soon' } } } },
                where,
            ) as string,
            /not a date/u,
        );
        assert.match(
            parseSuppressions({ version: 1, suppressions: { a: { b: { count: 1, owner: 3 } } } }, where) as string,
            /"owner" that is not text/u,
        );
    });

    it('per project: keys are relative to the project, which is the nearest manifest or suppressions file', () => {
        const files = new Set(['package.json', 'packages/web/package.json', 'packages/web/src/a.ts', 'tools/x.ts']);
        assert.equal(projectOf('packages/web/src/components', files), 'packages/web');
        assert.equal(projectOf('tools', files), '.');
        const web = read(
            JSON.stringify({
                version: 1,
                suppressions: { src: { 'max-files': { count: 3 } }, '.': { 'max-folders': { count: 9 } } },
            }),
            'packages/web',
            'packages/web/crowded-folders-suppressions.json',
        );
        assert.deepEqual(
            web.map(entry => entry.folder),
            ['packages/web', 'packages/web/src'],
        );
        assert.deepEqual(written(web, 'packages/web'), {
            '.': { 'max-folders': { count: 9 } },
            src: { 'max-files': { count: 3 } },
        });
    });
});
