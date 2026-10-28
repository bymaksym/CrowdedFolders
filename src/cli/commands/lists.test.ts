import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanUpAfterTests, cli, repository } from '../test-support/harness.ts';

cleanUpAfterTests();

/** A repository whose configuration loads the plugin `acme`, with `check` as the body of its rule `boom`. */
function withAcme(check: string): string {
    return repository({
        'node_modules/crowded-folders-plugin-acme/package.json': JSON.stringify({
            name: 'crowded-folders-plugin-acme',
            type: 'module',
            exports: './index.js',
        }),
        'node_modules/crowded-folders-plugin-acme/index.js': `export default {
            meta: { name: 'crowded-folders-plugin-acme', namespace: 'acme' },
            rules: { boom: { meta: { description: 'Blows up in src.', defaultOptions: {} }, check(folder, { report }) { ${check} } } },
            presets: { strict: { description: "Acme's layout.", sources: [], config: { rules: { 'acme/boom': 'error' } } } },
        };`,
        'crowded-folders.config.json':
            '{ "plugins": ["crowded-folders-plugin-acme"], "extends": ["recommended", "acme/strict"] }',
        'src/a.ts': '',
    });
}

describe('rules and presets with plugins', () => {
    it('lists the rules and presets of the plugins the configuration loads, and whose they are', async () => {
        const root = withAcme('');
        const rules = await cli(root, ['rules']);
        assert.equal(rules.code, 0, rules.err);
        assert.match(rules.out, /^max-files$/mu);
        assert.match(rules.out, /^acme\/boom {2}\(from crowded-folders-plugin-acme\)\n {2}Blows up in src\./mu);
        const presets = await cli(root, ['presets']);
        assert.equal(presets.code, 0, presets.err);
        assert.match(presets.out, /^acme\/strict {2}\(from crowded-folders-plugin-acme\)\n {2}Acme's layout\./mu);
        assert.match(presets.out, /^recommended$/mu);
    });

    it('lists the built-in ones without a configuration, and reads --config', async () => {
        const empty = repository({ 'a.ts': '' });
        const rules = await cli(empty, ['rules']);
        assert.equal(rules.code, 0);
        assert.doesNotMatch(rules.out, /acme/u);
        const missing = await cli(empty, ['rules', '--config', 'nope.json']);
        assert.equal(missing.code, 2);
        assert.match(missing.err, /--config nope\.json: .* does not exist/u);
    });
});

describe('a plugin rule that breaks', () => {
    it('is named with its folder and its package, exit 2, not "crowded-folders broke"', async () => {
        const root = withAcme(`if (folder.path === 'src') throw new TypeError('kaboom');`);
        const ran = await cli(root, []);
        assert.equal(ran.code, 2);
        assert.match(
            ran.err,
            /^crowded-folders: acme\/boom failed in src: kaboom \(report it to crowded-folders-plugin-acme\)$/mu,
        );
        assert.doesNotMatch(ran.err, /this is a bug/u);
    });

    it('is an error when it reports a path outside its folder, before SARIF or annotations see it', async () => {
        const root = withAcme(`report({ message: 'look', files: ['../../etc/passwd'] });`);
        const ran = await cli(root, ['--format', 'sarif']);
        assert.equal(ran.code, 2);
        assert.match(
            ran.err,
            /acme\/boom failed in \.: report\(\): files has "\.\.\/\.\.\/etc\/passwd", which climbs out/u,
        );
        // The failure is said in the report, and no result points at the file.
        assert.match(ran.out, /"results": \[\]/u);
        assert.doesNotMatch(ran.out, /"uri": "[^"]*passwd/u);
        assert.match(ran.out, /report it to crowded-folders-plugin-acme/u);
    });
});
