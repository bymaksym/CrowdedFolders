import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { runEngine } from '../../core/engine.ts';
import { ConfigError, loadConfig, loadConfigFile } from '../load-config.ts';

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

function folder(files: Readonly<Record<string, string>> = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'crowded-folders-layers-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

const rejects = async (promise: Promise<unknown>, pattern: RegExp): Promise<void> => {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof ConfigError, String(error));
        assert.match(error.message, pattern);
        return true;
    });
};

const many = (prefix: string, count: number, extension = '.ts'): string[] =>
    Array.from(
        { length: count },
        (_, index) => `${prefix}${String.fromCodePoint(97 + (index % 26))}${index}${extension}`,
    );

describe('strict', () => {
    it('gives the same limits whether it is listed before or after a language (-p go -p strict: 12, -p strict -p go: 30)', async () => {
        const root = folder();
        const after = await loadConfig({ extends: ['go', 'strict'] }, 'cli', root);
        const before = await loadConfig({ extends: ['strict', 'go'] }, 'cli', root);
        assert.deepEqual(before.config.rules, after.config.rules);
        assert.equal(before.config.rules['max-files']?.options['max'], 12);
        // go's main.go stays allowed alone in a folder, in both orders.
        assert.deepEqual(before.config.rules['single-file-folders'], {
            severity: 'warn',
            options: { allowed: ['main.go'] },
        });
        for (const preset of ['rust', 'react-native']) {
            const first = await loadConfig({ extends: ['strict', preset] }, 'cli', root);
            assert.equal(first.config.rules['single-file-folders']?.severity, 'warn', preset);
        }
    });

    it('does not turn on redundant-prefix in java and dotnet, where user/UserService is the idiom (Kenji)', async () => {
        const root = folder();
        for (const preset of ['java', 'android', 'dotnet']) {
            for (const extendsList of [
                [preset, 'strict'],
                ['strict', preset],
            ]) {
                const loaded = await loadConfig({ extends: extendsList }, 'cli', root);
                assert.equal(loaded.config.rules['redundant-prefix']?.severity, 'off', extendsList.join(' '));
                assert.equal(loaded.config.rules['max-files']?.options['max'], 12, extendsList.join(' '));
            }
        }
        // The configuration itself still decides.
        const mine = await loadConfig(
            { extends: ['java', 'strict'], rules: { 'redundant-prefix': 'error' } },
            'cli',
            root,
        );
        assert.equal(mine.config.rules['redundant-prefix']?.severity, 'error');
    });

    it('does not propose in angular a name that strict would then flag (Ideas Crowded Folders, 4)', async () => {
        const root = folder();
        const files = [
            ...['a', 'b', 'c', 'd', 'e'].map(part => `src/app/components/table-${part}.ts`),
            'src/app/components/app.ts',
            ...['i18n', 'routes', 'icons', 'fonts'].map(part => `tooling/release-${part}.mjs`),
            'tooling/build.mjs',
        ];
        for (const extendsList of [
            ['angular', 'strict'],
            ['strict', 'angular'],
        ]) {
            const loaded = await loadConfig({ extends: extendsList }, 'cli', root);
            const moves = runEngine({ files, config: loaded.config, rules: loaded.rules }).findings.flatMap(finding =>
                finding.moves.map(move => `${move.from} → ${move.to}`),
            );
            // src/ keeps the identifier in the name; tooling/ has none, and drops the prefix.
            assert.ok(
                moves.includes('src/app/components/table-a.ts → src/app/components/table/table-a.ts'),
                String(moves),
            );
            assert.ok(moves.includes('tooling/release-i18n.mjs → tooling/release/i18n.mjs'), String(moves));
            const moved = files.map(file =>
                file
                    .replace('components/table-', 'components/table/table-')
                    .replace('tooling/release-', 'tooling/release/'),
            );
            const after = runEngine({ files: moved, config: loaded.config, rules: loaded.rules }).findings;
            assert.deepEqual(
                after.filter(finding => finding.rule === 'redundant-prefix').map(finding => finding.folder),
                [],
                extendsList.join(' '),
            );
        }
    });
});

describe('overrides[].extends', () => {
    // server/pom.xml and an Angular web/: Kenji and Daniel's repository.
    const files = [
        'server/pom.xml',
        'server/build/generated/Thing.java',
        'server/src/main/java/com/acme/user/UserService.java',
        'server/src/main/java/com/acme/user/UserServiceImpl.java',
        'web/package.json',
        'web/build/stats.json',
        ...many('web/src/app/', 15),
        'web/src/app/FormatterImpl.ts',
        'web/src/app/Formatter.ts',
        'web/public/robots.txt',
        ...many('services/api/src/public/', 25, '.controller.ts'),
    ];

    it('applies a preset only under some folders: java under server/**, angular under web/**', async () => {
        const root = folder();
        const loaded = await loadConfig(
            {
                extends: ['recommended'],
                overrides: [
                    { folders: ['server/**'], extends: ['java'], reason: 'the Spring server, built with Maven' },
                    { folders: ['web/**'], extends: ['react'], reason: 'the web app, a React project' },
                ],
            },
            'mine.json',
            root,
        );
        const { exclude } = loaded.config;
        // java's /build is server's build, react's public is at any depth under web only.
        assert.ok(exclude.includes('server/build'), exclude.join(' '));
        assert.ok(exclude.includes('web/**/public'), exclude.join(' '));
        assert.ok(!exclude.includes('public'));
        const result = runEngine({ files, config: loaded.config, rules: loaded.rules, stats: true });
        const stat = (path: string) => result.folderStats?.find(folder => folder.path === path);
        // The 25 NestJS controllers under services/api/src/public are checked: react's exclude stops at web/.
        assert.ok(result.findings.some(finding => finding.folder === 'services/api/src/public'));
        assert.equal(stat('web/build')?.files, 1, 'web/build is not java’s build');
        assert.equal(stat('server/build'), undefined);
        // Impl is java's companion: one module in server, two in web.
        assert.equal(stat('server/src/main/java/com/acme/user')?.modules, 1);
        assert.equal(stat('web/src/app')?.modules, 17);
        assert.deepEqual(
            result.findings.filter(finding => finding.rule === 'config/unused-override'),
            [],
        );
    });

    it('takes presets only, and says which preset was meant', async () => {
        const root = folder({ 'base.json': '{}' });
        await rejects(
            loadConfig(
                { overrides: [{ folders: ['a/**'], extends: ['./base.json'], reason: 'a reason long enough' }] },
                'mine.json',
                root,
            ),
            /an override extends presets only/u,
        );
        await rejects(
            loadConfig(
                { overrides: [{ folders: ['a/**'], extends: ['jav'], reason: 'a reason long enough' }] },
                'mine.json',
                root,
            ),
            /"jav" is not a preset; did you mean "java"\?/u,
        );
    });

    it('tightens a preset under some folders with a strict applied to the whole tree', async () => {
        const loaded = await loadConfig(
            {
                extends: ['strict'],
                overrides: [{ folders: ['svc/**'], extends: ['go'], reason: 'the Go services of the repo' }],
            },
            'mine.json',
            folder(),
        );
        const files = many('svc/api/', 14, '.go');
        const findings = runEngine({ files, config: loaded.config, rules: loaded.rules }).findings;
        assert.deepEqual(
            findings.filter(finding => finding.rule === 'max-files').map(finding => finding.limit),
            [12],
        );
    });
});

describe('configurations of packages', () => {
    it('applies a package configuration with "root": false to its folder (apps/web with a limit of 5)', async () => {
        const root = folder({
            'crowded-folders.config.json': '{ "extends": ["recommended"] }',
            'apps/web/crowded-folders.config.json': JSON.stringify({
                root: false,
                extends: ['recommended', 'react'],
                exclude: ['/legacy'],
                rules: { 'max-files': ['error', { max: 5 }] },
                overrides: [
                    {
                        folders: ['src/generated'],
                        reason: 'written by the OpenAPI generator',
                        rules: { 'max-files': 'off' },
                    },
                ],
            }),
        });
        const loaded = await loadConfigFile(
            join(root, 'crowded-folders.config.json'),
            {},
            {
                nested: [{ path: join(root, 'apps/web/crowded-folders.config.json'), folder: 'apps/web' }],
            },
        );
        assert.ok(loaded.config.exclude.includes('apps/web/legacy'));
        const files = [
            ...many('apps/web/src/', 6),
            ...many('apps/web/src/generated/', 6),
            ...many('apps/web/legacy/', 6),
            ...many('apps/api/src/', 6),
        ];
        const result = runEngine({ files, config: loaded.config, rules: loaded.rules });
        assert.deepEqual(
            result.findings
                .filter(finding => finding.rule === 'max-files')
                .map(finding => `${finding.folder} ${finding.limit}`),
            ['apps/web/src 5'],
        );
        assert.deepEqual(loaded.warnings, []);
    });

    it('says that a package configuration without "root": false is not read from the top', async () => {
        const root = folder({
            'crowded-folders.config.json': '{}',
            'apps/web/crowded-folders.config.json': '{ "rules": { "max-files": ["error", { "max": 5 }] } }',
        });
        const loaded = await loadConfigFile(
            join(root, 'crowded-folders.config.json'),
            {},
            {
                nested: [{ path: join(root, 'apps/web/crowded-folders.config.json'), folder: 'apps/web' }],
            },
        );
        assert.equal(loaded.warnings.length, 1);
        assert.match(loaded.warnings[0] ?? '', /is not read when checking from .*Add "root": false to it/u);
    });

    it('refuses plugins, include and suppressions in a package configuration', async () => {
        const root = folder({
            'crowded-folders.config.json': '{}',
            'apps/web/crowded-folders.config.json': '{ "root": false, "include": ["src"] }',
        });
        await rejects(
            loadConfigFile(
                join(root, 'crowded-folders.config.json'),
                {},
                {
                    nested: [{ path: join(root, 'apps/web/crowded-folders.config.json'), folder: 'apps/web' }],
                },
            ),
            /include: a package configuration \("root": false\) cannot set include/u,
        );
    });

    it('reads the globs of a shared base.json from its own folder when a package extends it (Daniel)', async () => {
        const root = folder({
            'base.json': JSON.stringify({
                extends: ['recommended'],
                exclude: ['/tools', 'packages/a/vendored'],
                overrides: [
                    {
                        folders: ['packages/*/src/legacy/**'],
                        reason: 'the legacy code of every package',
                        rules: { 'max-files': 'off' },
                    },
                    {
                        folders: ['packages/b/**'],
                        reason: 'package b is generated code',
                        rules: { 'max-files': 'off' },
                    },
                ],
            }),
            'packages/a/crowded-folders.config.json': '{ "extends": ["../../base.json"] }',
        });
        const loaded = await loadConfigFile(join(root, 'packages/a/crowded-folders.config.json'));
        assert.deepEqual(
            loaded.config.overrides
                .filter(override => override.origin.endsWith('base.json'))
                .map(override => override.folders),
            [['src/legacy/**']],
        );
        assert.ok(loaded.config.exclude.includes('/vendored'));
        assert.ok(!loaded.config.exclude.includes('/tools'));
        const files = [...many('src/legacy/', 25), ...many('src/', 5)];
        const result = runEngine({ files, config: loaded.config, rules: loaded.rules });
        assert.deepEqual(result.findings, []);
    });

    it('reports the unused overrides of an extended file of the repository, not of a preset or a package', async () => {
        const root = folder({
            'shared.json': JSON.stringify({
                overrides: [
                    { folders: ['src/old'], reason: 'the old code, frozen until v3', rules: { 'max-files': 'off' } },
                ],
            }),
            'crowded-folders.config.json': '{ "extends": ["recommended", "./shared.json"] }',
        });
        const loaded = await loadConfigFile(join(root, 'crowded-folders.config.json'));
        const unused = runEngine({ files: ['src/a.ts'], config: loaded.config, rules: loaded.rules }).findings.filter(
            finding => finding.rule === 'config/unused-override',
        );
        assert.equal(unused.length, 1);
        assert.match(unused[0]?.message ?? '', /shared\.json/u);
    });
});

describe('--no-code and plugins', () => {
    it('checks the whole configuration before importing a plugin, so a broken one runs no code', async () => {
        const root = folder({
            'side-effect.mjs':
                "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./ran', import.meta.url), '');\nexport default { meta: { name: 'x', namespace: 'x' } };",
        });
        await rejects(
            loadConfig({ plugins: ['./side-effect.mjs'], rules: { 'max-file': 'error' } }, 'mine.json', root),
            /did you mean "max-files"/u,
        );
        assert.equal(existsSync(join(root, 'ran')), false);
        // A rule of the plugin itself is checked once it is loaded.
        await rejects(
            loadConfig({ plugins: ['./side-effect.mjs'], rules: { 'x/nope': 'error' } }, 'mine.json', root),
            /no plugin in "plugins" defines it/u,
        );
        assert.equal(existsSync(join(root, 'ran')), true);
    });

    it('reads only JSON with --no-code: no JavaScript configuration, extended module or plugin', async () => {
        const root = folder({
            'crowded-folders.config.mjs': 'export default {};',
            'base.mjs': 'export default {};',
            'base.json': '{ "rules": { "max-files": "warn" } }',
            'plugin.mjs': "export default { meta: { name: 'x', namespace: 'x' } };",
        });
        const noCode = { code: false } as const;
        await rejects(
            loadConfigFile(join(root, 'crowded-folders.config.mjs'), {}, noCode),
            /--no-code reads only JSON/u,
        );
        await rejects(
            loadConfig({ extends: ['./base.mjs'] }, 'mine.json', root, {}, noCode),
            /JavaScript, and --no-code/u,
        );
        await rejects(loadConfig({ plugins: ['./plugin.mjs'] }, 'mine.json', root, {}, noCode), /a plugin is code/u);
        const json = await loadConfig({ extends: ['./base.json'] }, 'mine.json', root, {}, noCode);
        assert.equal(json.config.rules['max-files']?.severity, 'warn');
    });
});
