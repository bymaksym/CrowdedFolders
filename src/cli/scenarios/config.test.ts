import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { runsTypeScript } from '../../node/config/file.ts';
import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

const files = (prefix: string, count: number, extension = '.ts'): Record<string, string> =>
    Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
            `${prefix}${String.fromCodePoint(97 + (index % 26))}${index}${extension}`,
            '',
        ]),
    );

describe('--preset and detection', () => {
    // The Swift list of the review: 25 View+X.swift extensions, which swift reads as one module.
    const swift = { 'Package.swift': '', ...files('Sources/App/View+', 25, '.swift') };

    it('adds --preset to what is detected (-p strict turned swift off without a word)', async () => {
        const root = repository(swift);
        const ran = await cli(root, ['explain', 'Sources/App', '--no-git', '-p', 'strict']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /25 files, 1 module,/u);
    });

    it('uses only the given presets with --no-detect, and says so', async () => {
        const root = repository(swift);
        const explained = await cli(root, ['explain', 'Sources/App', '--no-git', '--no-detect', '-p', 'strict']);
        assert.match(explained.out, /25 files, 25 modules/u);
        const checked = await cli(root, ['--no-git', '--no-detect', '-p', 'strict']);
        assert.match(checked.err, /used the presets given \(--no-detect\) - strict \(given with --preset\)/u);
    });
});

describe('configuration files', () => {
    it('reads crowded-folders.json at the root, the name people guess', async () => {
        const root = repository({
            'crowded-folders.json': JSON.stringify({ rules: { 'max-files': ['error', { max: 2 }] } }),
            ...files('src/', 3),
        });
        const ran = await cli(root, ['--no-git']);
        assert.equal(ran.code, 1, ran.err);
        assert.match(ran.out, /3 files, over the limit of 2/u);
    });

    it('reads .config/crowded-folders.cjs and crowded-folders.config.cjs', async () => {
        for (const name of ['.config/crowded-folders.cjs', 'crowded-folders.config.cjs']) {
            const root = repository({
                [name]: "module.exports = { rules: { 'max-files': ['error', { max: 2 }] } };",
                ...files('src/', 3),
            });
            const ran = await cli(root, ['--no-git']);
            assert.match(ran.out, /over the limit of 2/u, name);
        }
    });

    it('reads crowded-folders.config.ts where Node runs TypeScript, and says why not elsewhere', async () => {
        assert.equal(runsTypeScript({ typescript: false }), false);
        assert.equal(runsTypeScript({}), false);
        assert.equal(runsTypeScript({ typescript: 'strip' }), true);
        if (!runsTypeScript()) {
            return;
        }
        const root = repository({
            'crowded-folders.config.ts':
                "const max: number = 2;\nexport default { rules: { 'max-files': ['error', { max }] } };",
            ...files('src/', 3),
        });
        const ran = await cli(root, ['--no-git']);
        assert.match(ran.out, /over the limit of 2/u, ran.err);
    });

    it('says a file that looks like a configuration is not read (crowded-folders.yaml)', async () => {
        const root = repository({ 'crowded-folders.yaml': 'extends: [strict]', 'src/a.ts': '' });
        const ran = await cli(root, ['--no-git']);
        assert.match(ran.err, /crowded-folders\.yaml is not a name crowded-folders reads/u);
    });

    it('reads no code with --no-code: a JavaScript configuration is an error, exit 2 (bots, pull_request_target)', async () => {
        const root = repository({ 'crowded-folders.config.mjs': 'export default {};', 'src/a.ts': '' });
        const ran = await cli(root, ['--no-git', '--no-code']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /--no-code reads only JSON/u);
        assert.equal((await cli(root, ['--no-git'])).code, 0);
    });
});

describe('monorepos', () => {
    const monorepo = (packageConfig: Record<string, unknown>): string =>
        repository({
            'crowded-folders.config.json': JSON.stringify({ extends: ['recommended'] }),
            'apps/web/crowded-folders.config.json': JSON.stringify(packageConfig),
            ...files('apps/web/src/', 6),
            ...files('apps/api/src/', 6),
        });

    it('applies a package configuration with "root": false when checking from the top (Daniel: apps/web with 5)', async () => {
        const root = monorepo({ root: false, rules: { 'max-files': ['error', { max: 5 }] } });
        const ran = await cli(root, ['--no-git']);
        assert.equal(ran.code, 1, ran.err);
        assert.match(ran.out, /apps\/web\/src\/\n.*6 modules, over the limit of 5/u);
        assert.doesNotMatch(ran.out, /apps\/api/u);
    });

    it('says a package configuration without "root": false is not read from the top', async () => {
        const root = monorepo({ rules: { 'max-files': ['error', { max: 5 }] } });
        const ran = await cli(root, ['--no-git']);
        assert.equal(ran.code, 0);
        assert.match(ran.err, /apps[\\/]web[\\/]crowded-folders\.config\.json is not read when checking from/u);
    });

    it('checks only the package with the configuration above when run inside one with "root": false', async () => {
        const root = monorepo({ root: false, rules: { 'max-files': ['error', { max: 5 }] } });
        const ran = await cli(join(root, 'apps/web'), ['--no-git', '-f', 'json']);
        assert.equal(ran.code, 1, ran.err);
        const report = JSON.parse(ran.out) as { findings: { folder: string }[] };
        // The folders keep their names from the top, so suppressions match either way.
        assert.deepEqual(
            report.findings.map(finding => finding.folder),
            ['apps/web/src'],
        );
        assert.match(ran.err, /says "root": false, so .*crowded-folders\.config\.json is used/u);
    });

    it('checks one package with the repository configuration with --project (Nx, Turbo)', async () => {
        const root = repository({
            'crowded-folders.config.json': JSON.stringify({ rules: { 'max-files': ['error', { max: 5 }] } }),
            ...files('packages/a/src/', 6),
            ...files('packages/b/src/', 6),
        });
        const fromPackage = await cli(join(root, 'packages/a'), ['--no-git', '--project', '.', '-f', 'json']);
        const fromTop = await cli(root, ['--no-git', '--project', 'packages/a', '-f', 'json']);
        for (const ran of [fromPackage, fromTop]) {
            assert.equal(ran.code, 1, ran.err);
            const report = JSON.parse(ran.out) as { findings: { folder: string }[] };
            assert.deepEqual(
                report.findings.map(finding => finding.folder),
                ['packages/a/src'],
            );
        }
        const both = await cli(root, ['--no-git', '--project', 'packages/a', '--root', 'packages']);
        assert.equal(both.code, 2);
        assert.match((await cli(root, ['--project', 'nope'])).err, /--project nope: .* is not a folder/u);
    });

    it('writes an override for each preset found in a subfolder only (server/pom.xml, web/ angular)', async () => {
        const root = repository({
            'server/pom.xml': '',
            'server/src/main/java/App.java': '',
            'web/package.json': JSON.stringify({ dependencies: { '@angular/core': '^20.0.0' } }),
            'web/src/main.ts': '',
            'docs/mkdocs.yml': '',
            'docs/requirements.txt': 'mkdocs-material',
            'docs/index.md': '',
        });
        const ran = await cli(root, ['init', '--no-git']);
        assert.equal(ran.code, 0, ran.err);
        const config = JSON.parse(readFileSync(join(root, 'crowded-folders.config.json'), 'utf8')) as {
            extends: string[];
            overrides: { folders: string[]; extends: string[] }[];
        };
        // No python from the requirements.txt of mkdocs: there is no Python next to it.
        assert.deepEqual(config.extends, ['recommended']);
        assert.deepEqual(
            config.overrides.map(override => [override.folders.join(' '), override.extends.join(' ')]),
            [
                ['web/**', 'angular'],
                ['server/**', 'java'],
                ['docs/**', 'docs'],
            ],
        );
        assert.match(ran.out, /java {11}server\/pom\.xml \(only under server\/\*\*\)/u);
    });
});

describe('crowded-folders overrides', () => {
    it('lists what each override covers and silences, and points at one over most of the tree (Daniel: "**" off)', async () => {
        const root = repository({
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                overrides: [
                    {
                        folders: ['**'],
                        reason: 'too many problems to fix now',
                        owner: '@acme/web',
                        rules: { 'max-files': 'off', 'prefix-groups': 'off' },
                    },
                    { folders: ['src/legacy'], reason: 'being rewritten in v3', rules: { 'max-files': 'warn' } },
                ],
            }),
            'src/a.ts': '',
            'src/legacy/b.ts': '',
            'lib/c.ts': '',
        });
        const ran = await cli(root, ['overrides', '--no-git']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(
            ran.out,
            /"\*\*" {2}\(owner @acme\/web\)\n {4}too many problems to fix now\n {4}covers 4 of 4 folders \(100 %\)/u,
        );
        assert.match(ran.out, /⚠ silences max-files, prefix-groups in 100 % of the folders, more than 25 %/u);
        assert.match(
            ran.out,
            /"src\/legacy"\n {4}being rewritten in v3\n {4}covers 1 of 4 folders \(25 %\): src\/legacy\n {4}max-files warn\n/u,
        );
        assert.match(ran.out, /preset "recommended"/u);
        assert.match(ran.out, /^crowded-folders\.config\.json$/mu);
        const json = JSON.parse((await cli(root, ['overrides', '--no-git', '-f', 'json'])).out) as {
            overrides: { folders: string[]; broad: boolean; covers: string[]; origin: string }[];
        };
        assert.deepEqual(
            json.overrides.filter(override => override.broad).map(override => override.origin),
            ['crowded-folders.config.json'],
        );
        assert.deepEqual(
            json.overrides.filter(override => override.broad).map(override => override.folders),
            [['**']],
        );
    });
});

describe('crowded-folders overrides, the folders it names', () => {
    it('names a sixth folder rather than "and 1 more"', async () => {
        const folders = ['a', 'b', 'c', 'd', 'e', 'f'];
        const root = repository({
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                overrides: [
                    { folders: ['src/*'], reason: 'generated by the API client', rules: { 'max-files': 'warn' } },
                ],
            }),
            ...Object.fromEntries(folders.map(name => [`src/${name}/x.ts`, ''])),
        });
        const ran = await cli(root, ['overrides', '--no-git']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /covers 6 of \d+ folders \(\d+ %\): src\/a, src\/b, src\/c, src\/d, src\/e, src\/f\n/u);
        assert.doesNotMatch(ran.out, /and 1 more/u);
    });
});

describe('dot-files', () => {
    // Irina: 25 files at the root, 21 of them dot-files, counted as 4 even with dotfiles: true.
    const root25 = (): Record<string, string> => ({
        ...Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [`.tool${String.fromCodePoint(97 + index)}rc`, '']),
        ),
        'a.ts': '',
        'b.ts': '',
        'c.ts': '',
        '.github/workflows/ci.yml': '',
    });

    it('says that dotfiles: true sees nothing while recommended excludes ".*"', async () => {
        const root = repository({
            ...root25(),
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                rules: { 'max-files': ['error', { max: 10, dotfiles: true }] },
            }),
        });
        const ran = await cli(root, ['--no-git']);
        assert.equal(ran.code, 0);
        assert.match(ran.err, /dotfiles: true\), but "\.\*" in exclude .* add "!\.\*" and "\.\*\/" to exclude/u);
    });

    it('counts the dot-files with ".*/" in place of ".*": dot-folders only', async () => {
        const root = repository({
            ...root25(),
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                exclude: ['!.*', '.*/'],
                overrides: [
                    {
                        folders: ['.'],
                        reason: 'the root counts its tool settings',
                        rules: { 'max-files': ['error', { max: 10, dotfiles: true }] },
                    },
                ],
            }),
        });
        const ran = await cli(root, ['--no-git']);
        assert.equal(ran.code, 1, ran.err);
        // 21 dot-files, 3 modules and the configuration: .github/ is still left out.
        assert.match(ran.out, /25 modules, over the limit of 10/u);
        assert.doesNotMatch(ran.out, /\.github/u);
    });
});
