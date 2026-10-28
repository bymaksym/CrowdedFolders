import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runEngine } from '../engine.ts';
import { defineRule, type Rule } from '../rules/rule.ts';
import { resolveConfig } from './resolve.ts';
import type { Plugin } from './types.ts';
import { ConfigError } from './validate.ts';

const genericNames = defineRule({
    meta: { description: 'no utils', defaultOptions: { names: ['utils'] } },
    check(folder, { options, report }) {
        if (options.names.includes(folder.name)) report({ message: 'says nothing' });
    },
});

const acme: Plugin = {
    meta: { name: 'crowded-folders-plugin-acme', namespace: 'acme' },
    rules: { 'generic-names': genericNames },
    presets: {
        recommended: {
            description: 'test',
            sources: [],
            config: { extends: ['recommended'], rules: { 'acme/generic-names': 'warn' } },
        },
    },
};

describe('resolveConfig', () => {
    it('makes a configuration written by hand usable by runEngine (it failed with "Cannot read properties of undefined")', () => {
        const files = [
            'cli/render-json.ts',
            'cli/render-text.ts',
            'cli/render-pr.ts',
            'cli/render-sarif.ts',
            'cli/main.ts',
        ];
        const result = runEngine({ files, ...resolveConfig({ extends: ['recommended'] }) });
        assert.deepEqual(
            result.findings.map(finding => finding.key),
            ['render'],
        );
        // Without extends, only what it sets.
        const bare = resolveConfig({ rules: { 'max-files': ['error', { max: 3 }] } });
        assert.deepEqual(Object.keys(bare.config.rules), ['max-files']);
        assert.equal(runEngine({ files, ...bare }).findings[0]?.rule, 'max-files');
    });

    it('takes plugins as objects: their rules, their presets, and their name in "plugins"', () => {
        const resolved = resolveConfig(
            { plugins: ['crowded-folders-plugin-acme'], extends: ['acme/recommended'] },
            { plugins: [acme] },
        );
        assert.equal(resolved.config.rules['acme/generic-names']?.severity, 'warn');
        assert.deepEqual(resolved.config.layers, [
            'preset "recommended"',
            'preset "acme/recommended"',
            '(the configuration)',
        ]);
        const result = runEngine({ files: ['src/utils/a.ts'], ...resolved });
        assert.deepEqual(
            result.findings.map(finding => `${finding.rule} ${finding.folder}`),
            ['acme/generic-names src/utils'],
        );
    });

    it('reads nothing: a file, a package or a plugin not given is a ConfigError that says so', () => {
        assert.throws(
            () => resolveConfig({ extends: ['./base.json'] }),
            (error: unknown) => error instanceof ConfigError && error.message.includes('reads no files'),
        );
        assert.throws(() => resolveConfig({ plugins: ['crowded-folders-plugin-x'] }), /pass the plugin object/u);
        assert.throws(() => resolveConfig({ rules: { 'max-files': ['error', { max: -1 }] } }), /max/u);
        assert.throws(() => resolveConfig({ rules: { nope: 'error' } }), /is not a rule/u);
    });

    it('refuses a rule that is not one before it runs', () => {
        const async = {
            meta: { description: 'x', defaultOptions: {} },
            check: async (): Promise<void> => {
                await Promise.resolve();
            },
        } as unknown as Rule;
        assert.throws(() => resolveConfig({}, { rules: { 'acme/async': async } }), /check must be synchronous/u);
    });
});
