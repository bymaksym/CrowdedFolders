import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeLayer } from './config/merge.ts';
import { type Config, EMPTY_CONFIG } from './config/types.ts';
import { explainFolder, runEngine, selectFiles } from './engine.ts';
import { OverrideIndex } from './overrides.ts';
import { compileGlob } from './paths/glob.ts';
import { BUILT_IN_RULES } from './rules/index.ts';
import { defineRule } from './rules/rule.ts';

const resolve = (...layers: Config[]) =>
    layers.reduce(
        (config, layer, index) => mergeLayer(config, layer, `layer ${index}`, index === layers.length - 1),
        EMPTY_CONFIG,
    );

const crowded = Array.from({ length: 6 }, (_, index) => `src/legacy/f${index}.ts`);

describe('selectFiles', () => {
    it('keeps what include allows and drops what exclude names, at any depth', () => {
        const files = ['src/a.ts', 'src/fixtures/x.ts', 'docs/a.md', 'fixtures/y.ts'];
        assert.deepEqual(selectFiles(files, { include: ['src/**'], exclude: ['fixtures'] }), ['src/a.ts']);
        assert.deepEqual(selectFiles(files, { include: [], exclude: [] }), files);
    });
});

describe('runEngine', () => {
    it('applies an override with withFiles only to the folders that hold one of those files', () => {
        const config = resolve({
            rules: { 'max-files': ['error', { max: 5 }] },
            overrides: [
                {
                    folders: ['**'],
                    withFiles: ['package.json', 'go.mod'],
                    reason: 'the root of a package holds its tools',
                    rules: { 'max-files': ['error', { max: 10 }] },
                },
            ],
        });
        const files = [
            ...Array.from({ length: 8 }, (_, index) => `apps/shop/f${index}.json`),
            'apps/shop/package.json',
            ...Array.from({ length: 8 }, (_, index) => `apps/shop/src/f${index}.ts`),
        ];
        assert.deepEqual(
            runEngine({ files, config, rules: BUILT_IN_RULES }).findings.map(finding => finding.folder),
            ['apps/shop/src'],
        );
    });

    it('applies overrides in order, per folder', () => {
        const config = resolve({
            rules: { 'max-files': ['error', { max: 5 }] },
            overrides: [
                { folders: ['src/legacy'], reason: 'being rewritten', rules: { 'max-files': 'warn' } },
                { folders: ['src/legacy'], reason: 'and allowed more', rules: { 'max-files': ['warn', { max: 10 }] } },
            ],
        });
        assert.equal(runEngine({ files: crowded, config, rules: BUILT_IN_RULES }).findings.length, 0);
        const first = resolve({
            rules: { 'max-files': ['error', { max: 5 }] },
            overrides: [{ folders: ['src/legacy'], reason: 'being rewritten', rules: { 'max-files': 'warn' } }],
        });
        assert.equal(runEngine({ files: crowded, config: first, rules: BUILT_IN_RULES }).findings[0]?.severity, 'warn');
    });

    it('finds the overrides of a folder by the folders their globs name, in order, with 4 000 of them (37 s before)', () => {
        const overrides = Array.from({ length: 4000 }, (_, index) => ({
            folders: [`packages/p${index}/**`],
            reason: `package ${index} is allowed more`,
            rules: { 'max-files': ['error', { max: 100 }] } as const,
        }));
        const config = resolve({
            rules: { 'max-files': ['error', { max: 2 }] },
            overrides: [
                ...overrides,
                { folders: ['**/legacy'], reason: 'the legacy folders are frozen', rules: { 'max-files': 'off' } },
                {
                    folders: ['*/p7/**'],
                    reason: 'and p7 is strict again',
                    rules: { 'max-files': ['warn', { max: 2 }] },
                },
            ],
        });
        const files = ['p1', 'p7', 'p9'].flatMap(name =>
            ['a', 'b', 'c'].flatMap(file => [`packages/${name}/${file}.ts`, `packages/${name}/legacy/${file}.ts`]),
        );
        const findings = runEngine({ files, config, rules: BUILT_IN_RULES }).findings.filter(
            finding => finding.rule === 'max-files',
        );
        assert.deepEqual(
            findings.map(finding => `${finding.folder} ${finding.severity}`),
            ['packages/p7 warn', 'packages/p7/legacy warn'],
        );
        const explained = explainFolder({ files, config, rules: BUILT_IN_RULES }, 'packages/p7/legacy');
        assert.deepEqual(
            explained?.overrides.map(override => override.reason),
            ['package 7 is allowed more', 'the legacy folders are frozen', 'and p7 is strict again'],
        );
    });

    it('finds the overrides of a folder by a name after the wildcard when 400 share their folders (75 s before)', () => {
        const overrides = Array.from({ length: 400 }, (_, index) => ({
            folders: [`packages/*/src/x${index}/**`],
            reason: `x${index} is allowed more`,
            rules: { 'max-files': ['error', { max: 100 }] } as const,
        }));
        const config = resolve({
            rules: { 'max-files': ['error', { max: 2 }] },
            overrides: [
                ...overrides,
                {
                    folders: ['packages/p7/**'],
                    reason: 'and p7 is strict again',
                    rules: { 'max-files': ['warn', { max: 2 }] },
                },
            ],
        });
        const files = ['p1', 'p7'].flatMap(name =>
            ['x3', 'x250'].flatMap(x => ['a', 'b', 'c'].map(file => `packages/${name}/src/${x}/${file}.ts`)),
        );
        const findings = runEngine({ files, config, rules: BUILT_IN_RULES }).findings.filter(
            finding => finding.rule === 'max-files',
        );
        assert.deepEqual(
            findings.map(finding => `${finding.folder} ${finding.severity}`),
            ['packages/p7/src/x250 warn', 'packages/p7/src/x3 warn'],
        );
        const explained = explainFolder({ files, config, rules: BUILT_IN_RULES }, 'packages/p7/src/x250');
        assert.deepEqual(
            explained?.overrides.map(override => override.reason),
            ['x250 is allowed more', 'and p7 is strict again'],
        );
        // The work, which a clock on a shared machine does not tell: each folder tries the overrides of
        // its own name, not the 400 filed under "packages".
        const index = new OverrideIndex(
            config.overrides.map(state => ({
                state,
                globs: state.folders.map(compileGlob),
                withFiles: [],
                within: [],
                used: false,
            })),
        );
        assert.deepEqual(
            index.candidatesFor('packages/p1/src/x3').map(candidate => candidate.state.reason),
            ['x3 is allowed more'],
        );
        assert.equal(index.candidatesFor('packages/p7/src/x250/deep').length, 2);
    });

    it('reports an override past its expires as config/expired-override, and still applies it (Daniel)', () => {
        const config = resolve({
            rules: { 'max-files': ['error', { max: 5 }] },
            overrides: [
                {
                    folders: ['src/legacy'],
                    reason: 'being rewritten in v3',
                    expires: '2026-06-30',
                    owner: '@acme/web',
                    ticket: 'WEB-12',
                    rules: { 'max-files': 'off' },
                },
            ],
        });
        const before = runEngine({ files: crowded, config, rules: BUILT_IN_RULES, today: '2026-06-30' });
        assert.deepEqual(before.findings, []);
        const after = runEngine({ files: crowded, config, rules: BUILT_IN_RULES, today: '2026-07-01' });
        assert.deepEqual(
            after.findings.map(finding => [finding.rule, finding.severity, finding.message]),
            [
                [
                    'config/expired-override',
                    'warn',
                    'The override for "src/legacy" in layer 0 expired on 2026-06-30 (owner @acme/web, ticket WEB-12): "being rewritten in v3". It still applies: review it, then renew "expires" or remove it.',
                ],
            ],
        );
        const elsewhere = runEngine({
            files: [...crowded, 'lib/a.ts'],
            config,
            rules: BUILT_IN_RULES,
            today: '2027-01-01',
            only: ['lib'],
        });
        assert.deepEqual(elsewhere.findings, []);
    });

    it('reports an override of the own configuration that matches no folder', () => {
        const config = resolve({
            rules: { 'max-files': ['error', { max: 50 }] },
            overrides: [{ folders: ['src/gone'], reason: 'it was big', rules: { 'max-files': 'off' } }],
        });
        const [finding] = runEngine({ files: crowded, config, rules: BUILT_IN_RULES }).findings;
        assert.equal(finding?.rule, 'config/unused-override');
        assert.equal(finding?.severity, 'warn');
        assert.match(finding?.message ?? '', /"src\/gone".*it was big/u);
    });

    it('does not report an unused override that a preset brought', () => {
        const config = resolve(
            { overrides: [{ folders: ['**/res/*'], reason: 'android', rules: { 'max-files': 'off' } }] },
            { rules: { 'max-files': ['error', { max: 50 }] } },
        );
        assert.equal(runEngine({ files: crowded, config, rules: BUILT_IN_RULES }).findings.length, 0);
    });

    it('checks and counts only the folders asked for (crowded-folders src/app/shared counted the whole repository)', () => {
        const files = [...crowded, ...crowded.map(path => path.replace('legacy', 'other'))];
        const config = resolve({ rules: { 'max-files': ['error', { max: 5 }] } });
        const result = runEngine({ files, config, rules: BUILT_IN_RULES, only: ['src/other'] });
        assert.deepEqual(
            result.findings.map(finding => finding.folder),
            ['src/other'],
        );
        assert.equal(result.fileCount, 6);
        assert.equal(result.folderCount, 1);
    });

    it('runs plugin rules with their defaults under the configured options', () => {
        const seen: unknown[] = [];
        const probe = defineRule({
            meta: { description: 'probe', defaultOptions: { a: 1, list: ['x'] } },
            check(folder, { options, report }) {
                seen.push(options);
                if (folder.path === 'src/legacy') {
                    report({ message: 'seen', files: ['f0.ts'] });
                }
            },
        });
        const config = resolve({ rules: { 'p/probe': ['warn', { list: ['y'] }] } });
        const result = runEngine({ files: crowded, config, rules: { ...BUILT_IN_RULES, 'p/probe': probe } });
        assert.deepEqual(seen[0], { a: 1, list: ['x', 'y'] });
        assert.deepEqual(result.findings[0]?.files, ['src/legacy/f0.ts']);
        assert.equal(result.findings[0]?.measured, 1);
    });

    it('sorts findings by folder, then rule, then key', () => {
        const files = ['b/ext-1.ts', 'b/ext-2.ts', 'b/ext-3.ts', 'b/ext-4.ts', 'b/y.ts', ...crowded];
        const config = resolve({ rules: { 'max-files': ['error', { max: 4 }], 'prefix-groups': 'error' } });
        assert.deepEqual(
            runEngine({ files, config, rules: BUILT_IN_RULES }).findings.map(
                finding => `${finding.folder} ${finding.rule}`,
            ),
            ['b max-files', 'b prefix-groups', 'src/legacy max-files'],
        );
    });
});

describe('explainFolder', () => {
    it('shows the overrides, the options in effect and the findings of one folder', () => {
        const config = resolve({
            rules: { 'max-files': ['error', { max: 5 }] },
            overrides: [{ folders: ['src/*'], reason: 'why', rules: { 'max-files': ['error', { max: 3 }] } }],
        });
        const explanation = explainFolder({ files: crowded, config, rules: BUILT_IN_RULES }, 'src/legacy');
        assert.equal(explanation?.overrides[0]?.reason, 'why');
        assert.equal(explanation?.rules['max-files']?.effectiveOptions['max'], 3);
        assert.equal(explanation?.findings.length, 1);
        assert.equal(explainFolder({ files: crowded, config, rules: BUILT_IN_RULES }, 'nowhere'), undefined);
    });
});
