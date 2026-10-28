import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { ConfigError, loadConfig } from './load-config.ts';
import { compatibilityProblem, OWN_VERSION, packageDirOf, resolveSpecifier } from './modules.ts';

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

function folder(files: Readonly<Record<string, string>> = {}): string {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'crowded-folders-modules-')));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

/** A plugin package's files, under node_modules/<name>. */
function pluginPackage(name: string, manifest: Record<string, unknown>, index: string): Record<string, string> {
    return {
        [`node_modules/${name}/package.json`]: JSON.stringify({ name, type: 'module', ...manifest }),
        [`node_modules/${name}/index.js`]: index,
    };
}

const RULE = `{ meta: { description: 'd', defaultOptions: {} }, check() {} }`;

describe('plugin versions (peerDependencies)', () => {
    it('refuses a plugin made for another major version, with both versions, before it runs', async () => {
        const root = folder(
            pluginPackage(
                'crowded-folders-plugin-future',
                { version: '3.1.0', peerDependencies: { 'crowded-folders': '^2.0.0' } },
                `export default { meta: { name: 'crowded-folders-plugin-future', namespace: 'future' }, rules: { a: ${RULE} } };`,
            ),
        );
        await assert.rejects(
            loadConfig({ plugins: ['crowded-folders-plugin-future'] }, 'test.json', root),
            (error: unknown) => {
                assert.ok(error instanceof ConfigError);
                assert.match(
                    error.message,
                    new RegExp(
                        String.raw`"crowded-folders-plugin-future" 3\.1\.0 is made for crowded-folders \^2\.0\.0 \(its peerDependencies\), and this is ${OWN_VERSION.replaceAll('.', String.raw`\.`)}`,
                        'u',
                    ),
                );
                return true;
            },
        );
    });

    it('says nothing for a range it cannot read, a plugin without one, or a local file', () => {
        const root = folder({
            'node_modules/a/package.json': JSON.stringify({
                name: 'a',
                peerDependencies: { 'crowded-folders': 'workspace:*' },
            }),
            'node_modules/a/index.js': '',
            'node_modules/b/package.json': JSON.stringify({ name: 'b' }),
            'node_modules/b/index.js': '',
        });
        assert.equal(compatibilityProblem('a', join(root, 'node_modules/a/index.js'), '1.0.0'), undefined);
        assert.equal(compatibilityProblem('b', join(root, 'node_modules/b/index.js'), '1.0.0'), undefined);
        assert.equal(compatibilityProblem('./plugin.js', join(root, 'plugin.js'), '1.0.0'), undefined);
    });

    it('reads the version of this package', () => {
        assert.match(OWN_VERSION, /^\d+\.\d+\.\d+/u);
    });
});

describe('resolving a plugin package', () => {
    it('follows subpath patterns in exports ("./*")', () => {
        const root = folder({
            'node_modules/acme/package.json': JSON.stringify({
                name: 'acme',
                exports: { '.': './index.js', './presets/*': { import: './dist/presets/*.js' } },
            }),
            'node_modules/acme/dist/presets/react.js': '',
        });
        assert.equal(
            resolveSpecifier('acme/presets/react', root),
            join(root, 'node_modules', 'acme', 'dist', 'presets', 'react.js'),
        );
        assert.throws(() => resolveSpecifier('acme/other', root), /does not export "\.\/other"/u);
    });

    it("finds a package through Yarn Plug'n'Play's API when there is no node_modules", () => {
        const root = folder({ 'cache/acme/package.json': JSON.stringify({ name: 'acme' }) });
        const issuers: string[] = [];
        const pnp = {
            resolveToUnqualified: (request: string, issuer: string) => {
                issuers.push(issuer);
                return request === 'acme' ? join(root, 'cache', 'acme') : null;
            },
        };
        assert.equal(packageDirOf('acme', join(root, 'project'), pnp), join(root, 'cache', 'acme'));
        assert.deepEqual(issuers, [`${join(root, 'project')}/`]);
        assert.equal(packageDirOf('missing', join(root, 'project'), pnp), undefined);
    });

    it("falls back to Node's own resolution (createRequire): a plugin's repository naming itself", () => {
        // No node_modules/acme anywhere: Node finds it by self-reference, from inside the package.
        const root = folder({
            'package.json': JSON.stringify({
                name: 'crowded-folders-plugin-self',
                type: 'module',
                exports: { '.': './index.js', './package.json': './package.json' },
            }),
            'index.js': '',
        });
        assert.equal(packageDirOf('crowded-folders-plugin-self', join(root, 'config'), undefined), root);
        assert.equal(resolveSpecifier('crowded-folders-plugin-self', root), join(root, 'index.js'));
    });
});
