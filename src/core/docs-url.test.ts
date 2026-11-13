import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { mergeLayer } from './config/merge.ts';
import { EMPTY_CONFIG } from './config/types.ts';
import { docsUrl, PACKAGE_VERSION, REPOSITORY_URL } from './docs-url.ts';
import { runEngine } from './engine.ts';
import { BUILT_IN_PRESETS } from './presets/index.ts';
import { BUILT_IN_RULES } from './rules/index.ts';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
};

describe('the address of the documentation', () => {
    it('names the version, so that whoever pins 1.0.1 reads the pages of 1.0.1 and not those of main', () => {
        assert.equal(docsUrl('rules/max-files.md', '1.0.1'), `${REPOSITORY_URL}/blob/v1.0.1/docs/rules/max-files.md`);
        assert.equal(docsUrl('ci.md'), `${REPOSITORY_URL}/blob/v${PACKAGE_VERSION}/docs/ci.md`);
    });

    it('is the version of package.json: release-please keeps both lines in step', () => {
        assert.equal(PACKAGE_VERSION, manifest.version);
    });

    it('is what every built-in rule, finding and preset source links to, never main', () => {
        const prefix = `${REPOSITORY_URL}/blob/v${manifest.version}/docs/`;
        for (const [name, rule] of Object.entries(BUILT_IN_RULES)) {
            assert.equal(rule.meta.url, `${prefix}rules/${name}.md`, name);
        }
        for (const [name, preset] of Object.entries(BUILT_IN_PRESETS)) {
            for (const source of preset.sources) {
                assert.ok(!source.url.includes('/blob/main/'), `${name}: ${source.url}`);
            }
        }
        const config = mergeLayer(EMPTY_CONFIG, { rules: { 'max-files': ['error', { max: 1 }] } }, 'test', true);
        const [finding] = runEngine({ files: ['a/x.ts', 'a/y.ts'], config, rules: BUILT_IN_RULES }).findings;
        assert.equal(finding?.url, `${prefix}rules/max-files.md`);
    });
});
