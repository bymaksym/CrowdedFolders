import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_PRESETS } from './core/presets/index.ts';
import type { Rule } from './engine.ts';
import {
    createLinter,
    defineRule,
    detectPresets,
    FileListError,
    lint,
    resolveConfig,
    RuleError,
    runEngine,
} from './index.ts';
import { loadConfig } from './node/load-config.ts';

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A repository on disk, outside any git repository. */
function repository(files: Readonly<Record<string, string>>): string {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'crowded-folders-api-')));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

const RENDER = ['cli/render-json.ts', 'cli/render-text.ts', 'cli/render-pr.ts', 'cli/render-sarif.ts', 'cli/main.ts'];

describe('lint()', () => {
    it('checks a list of files with a configuration object, the way docs/plugins.md tests a plugin', async () => {
        const genericNames = defineRule({
            meta: { description: 'no utils', defaultOptions: { names: ['utils'] } },
            check(folder, { options, report }) {
                if (options.names.includes(folder.name)) {
                    report({ message: 'says nothing', files: folder.files });
                }
            },
        });
        const result = await lint({
            config: { rules: { 'acme/generic-names': 'error' } },
            rules: { 'acme/generic-names': genericNames },
            files: ['src/utils/a.ts', 'src/user/b.ts'],
        });
        assert.deepEqual(
            result.findings.map(finding => `${finding.rule} ${finding.folder}`),
            ['acme/generic-names src/utils'],
        );
    });

    it('uses recommended when there is no configuration to find', async () => {
        // From a folder with no configuration above it, so the result does not depend on this repository's.
        const result = await lint({ cwd: tmpdir(), files: RENDER });
        assert.deepEqual(
            result.findings.map(finding => finding.key),
            ['render'],
        );
        assert.equal(result.fileCount, 5);
        assert.deepEqual(result.presets, ['recommended']);
        assert.equal(result.configFile, undefined);
    });

    it('reads files the way the command does (./src made a folder "./src", src\\a.ts went to the root)', async () => {
        const files = ['./cli/render-json.ts', String.raw`cli\render-text.ts`, ...RENDER.slice(2)];
        const result = await lint({ cwd: tmpdir(), root: tmpdir(), files });
        assert.deepEqual(
            result.findings.map(finding => `${finding.folder} ${finding.key ?? ''}`),
            ['cli render'],
        );
        await assert.rejects(lint({ cwd: tmpdir(), root: tmpdir(), files: ['../outside/a.ts'] }), FileListError);
        await assert.rejects(lint({ cwd: tmpdir(), root: tmpdir(), files: ['/src/a.ts'] }), FileListError);
    });

    it('detects the presets without a configuration, as the command does (angular.json and 12 files gave [])', async () => {
        const components = Array.from(
            { length: 12 },
            (_, index) => [`src/app/features/shop/widget-${index}.component.ts`, ''] as const,
        );
        const root = repository({ 'angular.json': '{}', ...Object.fromEntries(components) });
        const result = await lint({ cwd: root });
        assert.ok(result.presets.includes('angular'), result.presets.join(', '));
        assert.equal(result.detected?.find(detection => detection.preset === 'angular')?.evidence, 'angular.json');
        assert.deepEqual(
            result.findings.map(finding => `${finding.rule} ${finding.folder}`),
            ['max-files src/app/features/shop'],
        );
        assert.equal(result.exitCode, 1);
    });

    it('applies the suppressions as the command does, and returns what it would exit with', async () => {
        const kept = { 'cli/': { 'prefix-groups#render': { count: 4 } } };
        const suppressions = { version: 1, suppressions: { ...kept, 'gone/': { 'max-files': { count: 30 } } } };
        const root = repository({
            'crowded-folders.config.json': '{ "extends": ["recommended"] }',
            'crowded-folders-suppressions.json': JSON.stringify(suppressions),
            ...Object.fromEntries(RENDER.map(path => [path, ''])),
        });
        const without = await lint({ cwd: root });
        assert.equal(without.kept.length, 1);
        assert.equal(without.exitCode, 1);
        // The configuration and the five modules: the suppressions file is not counted, applied or not.
        assert.equal(without.fileCount, 6);

        const result = await lint({ cwd: root, suppressions: true });
        assert.deepEqual(result.kept, []);
        assert.deepEqual(
            result.suppressed.map(finding => finding.key),
            ['render'],
        );
        assert.deepEqual(
            result.stale.map(stale => `${stale.folder} ${stale.status}`),
            ['gone missing-folder'],
        );
        assert.equal(result.exitCode, 1);
        assert.equal(result.configFile, join(root, 'crowded-folders.config.json'));
        assert.deepEqual(result.presets, ['recommended']);

        writeFileSync(
            join(root, 'crowded-folders-suppressions.json'),
            JSON.stringify({ version: 1, suppressions: kept }),
        );
        assert.equal((await lint({ cwd: root, suppressions: true })).exitCode, 0);
    });

    it('names the plugin a broken rule comes from, instead of calling it a bug of crowded-folders', async () => {
        const root = repository({
            'node_modules/crowded-folders-plugin-acme/package.json': JSON.stringify({
                name: 'crowded-folders-plugin-acme',
                type: 'module',
                exports: './index.js',
            }),
            'node_modules/crowded-folders-plugin-acme/index.js': `export default {
                meta: { name: 'crowded-folders-plugin-acme', namespace: 'acme' },
                rules: { boom: { meta: { description: 'd', defaultOptions: {} }, check(folder) { if (folder.path === 'src') throw new Error('kaboom'); } } },
            };`,
            'crowded-folders.config.json':
                '{ "plugins": ["crowded-folders-plugin-acme"], "rules": { "acme/boom": "error" } }',
            'src/a.ts': '',
        });
        await assert.rejects(lint({ cwd: root }), (error: unknown) => {
            assert.ok(error instanceof RuleError);
            assert.equal(error.message, 'acme/boom failed in src: kaboom (report it to crowded-folders-plugin-acme)');
            return true;
        });
    });

    it('refuses a rule given in options that is not one (async, an unsupported schema keyword)', async () => {
        const async = {
            meta: { description: 'x', defaultOptions: {} },
            check: async (): Promise<void> => {
                await Promise.resolve();
            },
        } as unknown as Rule;
        await assert.rejects(
            lint({ cwd: tmpdir(), files: [], rules: { 'acme/a': async } }),
            /check must be synchronous/u,
        );
    });
});

describe('createLinter()', () => {
    it('loads the configuration once and runs on new files each time, without state between runs', async () => {
        let created = 0;
        const counts = defineRule({
            meta: { description: 'counts', defaultOptions: {} },
            create({ report }) {
                created++;
                let folders = 0;
                return {
                    folder() {
                        folders++;
                    },
                    done() {
                        report({ folder: '.', message: `${folders} folders`, measured: folders });
                    },
                };
            },
        });
        const linter = await createLinter({
            cwd: tmpdir(),
            config: { extends: ['recommended'], rules: { 'acme/counts': 'warn' } },
            rules: { 'acme/counts': counts },
        });
        assert.ok(Object.isFrozen(linter));
        const first = linter.lint({ files: RENDER });
        assert.deepEqual(
            first.findings.map(finding => `${finding.rule} ${finding.key ?? finding.measured}`),
            ['acme/counts 2', 'prefix-groups render'],
        );
        const second = linter.lint({ files: ['a/b/c.ts'] });
        assert.deepEqual(
            second.findings.map(finding => `${finding.rule} ${finding.measured}`),
            ['acme/counts 3'],
        );
        assert.equal(created, 2);
        assert.deepEqual(linter.lint({ files: RENDER }).findings, first.findings);
    });

    it('checks only some folders when asked, as an editor does for the open one', async () => {
        const linter = await createLinter({ cwd: tmpdir(), config: { extends: ['recommended'] } });
        const result = linter.lint({ files: [...RENDER, ...RENDER.map(path => `other/${path}`)], only: ['other'] });
        assert.deepEqual(
            result.findings.map(finding => finding.folder),
            ['other/cli'],
        );
    });

    it('says what a new file would do to its folder, for the files given and for a path outside the root', async () => {
        const linter = await createLinter({ cwd: tmpdir(), config: { extends: ['recommended'] } });
        const [fourth, other] = linter.where(['cli/render-sarif.ts', 'cli/main-two.ts'], {
            files: [...RENDER.slice(0, 3), 'cli/main.ts'],
        });
        assert.equal(fourth?.effect, 'creates');
        assert.equal(fourth?.changes[0]?.rule, 'prefix-groups');
        assert.deepEqual(fourth?.candidates, [
            { folder: 'cli/render', kind: 'move', reason: 'prefix-groups would put it there (the group "render")' },
        ]);
        assert.equal(other?.effect, 'neutral');
        assert.throws(() => linter.where(['../x.ts'], { files: RENDER }), FileListError);
    });
});

describe('resolveConfig()', () => {
    it('resolves every built-in preset exactly as loading a configuration does', async () => {
        for (const name of Object.keys(BUILT_IN_PRESETS)) {
            const config = { extends: [name], rules: { 'max-files': ['warn', { max: 9 }] } } as const;
            const loaded = await loadConfig(config, '(the configuration)', tmpdir());
            assert.deepEqual(resolveConfig(config).config, loaded.config, name);
        }
    });

    it('is what runEngine needs, from the same entry point', () => {
        const result = runEngine({ files: RENDER, ...resolveConfig({ extends: ['recommended'] }) });
        assert.equal(result.findings[0]?.key, 'render');
    });
});

describe('detectPresets()', () => {
    it('takes file paths and dependency names', () => {
        assert.deepEqual(
            detectPresets(['angular.json', 'src/main.ts']).map(detection => detection.preset),
            ['recommended', 'angular'],
        );
        assert.ok(
            detectPresets(['package.json'], { dependencies: ['@nestjs/core'] }).some(
                detection => detection.preset === 'nestjs',
            ),
        );
    });
});

describe('crowded-folders/engine and crowded-folders/testing', () => {
    /** Every module the entry imports, followed through relative imports, with what each imports. */
    function importsOf(entry: string): Map<string, string[]> {
        const seen = new Map<string, string[]>();
        const pending = [entry];
        for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
            if (seen.has(file)) continue;
            const text = readFileSync(file, 'utf8');
            const specifiers = [...text.matchAll(/^(?:import|export)\b[^;]+?\bfrom '([^']+)'/gmu)].map(
                match => match[1] ?? '',
            );
            seen.set(file, specifiers);
            for (const specifier of specifiers) {
                if (specifier.startsWith('.')) pending.push(join(dirname(file), specifier));
            }
        }
        return seen;
    }

    for (const entry of ['engine.ts', 'testing.ts']) {
        it(`${entry} reaches nothing from Node, so it bundles for a browser`, () => {
            const graph = importsOf(fileURLToPath(new URL(entry, import.meta.url)));
            assert.ok(graph.size > 10, `followed ${graph.size} modules`);
            for (const [file, specifiers] of graph) {
                for (const specifier of specifiers) {
                    assert.ok(
                        specifier.startsWith('.') &&
                            !/\/(?:node|cli)\//u.test(join(dirname(file), specifier).replaceAll('\\', '/')),
                        `${file} imports ${specifier}`,
                    );
                }
            }
        });
    }
});
