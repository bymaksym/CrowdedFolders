import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { pinnedSchemaUrl } from '../core/config/schema.ts';
import { cleanUpAfterTests, cli, repository } from './test-support/harness.ts';
import { TOOL } from './tool.ts';

cleanUpAfterTests();

const FILES = { 'src/a.ts': '', 'src/b.ts': '' };
const read = (root: string, path: string): { $schema: string; extends: string[] } =>
    JSON.parse(readFileSync(join(root, path), 'utf8')) as { $schema: string; extends: string[] };

describe('where init writes', () => {
    it('writes where --config says, creating its folders, and says it will not be found by that name', async () => {
        const root = repository(FILES);
        const ran = await cli(root, ['init', '--config', 'tools/structure.json']);
        assert.equal(ran.code, 0, ran.err);
        assert.deepEqual(read(root, 'tools/structure.json').extends, ['recommended']);
        assert.equal(existsSync(join(root, 'crowded-folders.config.json')), false);
        assert.match(ran.out, /structure\.json is not a name crowded-folders looks for: pass --config/u);
    });

    it('writes into .config/ when the repository keeps its configurations there, and the next run reads it', async () => {
        const root = repository({ ...FILES, '.config/other.json': '{}' });
        const ran = await cli(root, ['init']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^Wrote \.config[\\/]crowded-folders\.json with recommended/u);
        assert.equal(existsSync(join(root, 'crowded-folders.config.json')), false);
        const next = await cli(root, []);
        assert.equal(next.code, 0, next.err);
        assert.doesNotMatch(next.err, /No configuration file/u);
    });

    it('writes crowded-folders.config.json at the root otherwise', async () => {
        const root = repository(FILES);
        assert.equal((await cli(root, ['init'])).code, 0);
        assert.ok(existsSync(join(root, 'crowded-folders.config.json')));
    });

    it('will not write a file where a folder is, nor a name that is not JSON', async () => {
        const root = repository({ ...FILES, 'conf/x': '' });
        assert.match((await cli(root, ['init', '--config', 'conf'])).err, /is a folder; name the file to write/u);
        assert.match((await cli(root, ['init', '--config', 'x.mjs'])).err, /init writes JSON; name the file \*\.json/u);
    });
});

describe('init with a configuration that exists', () => {
    it('--force replaces a JSON one in its place, leaving one configuration', async () => {
        const root = repository({ ...FILES, '.config/crowded-folders.json': '{"extends":["strict"]}' });
        assert.match((await cli(root, ['init'])).err, /already exists: edit it, or pass --force/u);
        const ran = await cli(root, ['init', '--force']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /^Replaced \.config[\\/]crowded-folders\.json/u);
        assert.deepEqual(read(root, '.config/crowded-folders.json').extends, ['recommended']);
        assert.equal(existsSync(join(root, 'crowded-folders.config.json')), false);
        assert.equal((await cli(root, [])).code, 0);
    });

    it('refuses to replace a .mjs or a package.json key, and says why, instead of leaving two configurations', async () => {
        const mjs = repository({ ...FILES, 'crowded-folders.config.mjs': 'export default { extends: ["strict"] };' });
        const ran = await cli(mjs, ['init', '--force']);
        assert.equal(ran.code, 2);
        assert.match(
            ran.err,
            /crowded-folders\.config\.mjs is JavaScript: init writes JSON and will not replace code/u,
        );
        assert.equal(existsSync(join(mjs, 'crowded-folders.config.json')), false);
        const manifest = repository({ ...FILES, 'package.json': '{"crowded-folders":{"extends":["strict"]}}' });
        const second = await cli(manifest, ['init', '--force']);
        assert.equal(second.code, 2);
        assert.match(second.err, /is in .*package\.json under "crowded-folders"/u);
        assert.equal(existsSync(join(manifest, 'crowded-folders.config.json')), false);
    });

    it('will not write beside another configuration with --config', async () => {
        const root = repository({ ...FILES, 'crowded-folders.config.json': '{}' });
        const ran = await cli(root, ['init', '--config', 'crowded-folders.config.jsonc']);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /would leave two/u);
    });
});

describe('what init writes and says', () => {
    it('pins the schema to the major version of this one', async () => {
        assert.equal(pinnedSchemaUrl('1.0.0'), 'https://unpkg.com/crowded-folders@1/schema.json');
        assert.equal(pinnedSchemaUrl('2.7.1'), 'https://unpkg.com/crowded-folders@2/schema.json');
        assert.equal(pinnedSchemaUrl('0.5.3'), 'https://unpkg.com/crowded-folders@0.5/schema.json');
        const root = repository(FILES);
        await cli(root, ['init']);
        assert.equal(read(root, 'crowded-folders.config.json').$schema, pinnedSchemaUrl(TOOL.version));
        assert.match(read(root, 'crowded-folders.config.json').$schema, /crowded-folders@\d+(\.\d+)?\/schema\.json$/u);
    });

    it('leaves one line to copy: npx crowded-folders through npx, crowded-folders otherwise', async () => {
        const render = {
            'cli/render-json.ts': '',
            'cli/render-text.ts': '',
            'cli/render-sarif.ts': '',
            'cli/render-pr.ts': '',
            'cli/main.ts': '',
            'package.json': '{}',
        };
        const viaNpx = await cli(repository(render), ['init'], { npm_command: 'exec' });
        assert.equal(viaNpx.out.match(/^Next: /gmu)?.length, 1);
        assert.match(viaNpx.out, /^Next: npx crowded-folders$/mu);
        assert.match(viaNpx.out, /1 error today\./u);
        assert.match(viaNpx.out, /npx crowded-folders --suppress-all/u);
        assert.match(viaNpx.out, /"scripts": \{ "folders": "npx --yes crowded-folders" \} in package\.json/u);
        assert.match(viaNpx.out, /in CI \(.*docs\/ci\.md\)/u);
        const installed = await cli(repository(render), ['init']);
        assert.match(installed.out, /^Next: crowded-folders$/mu);
        assert.match(installed.out, /"folders": "crowded-folders"/u);
    });

    it('counts warnings as well as errors, and sends a clean repository to the CI', async () => {
        const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`src/file${index}.ts`, '']));
        const warned = await cli(repository(many), ['init']);
        assert.match(warned.out, /\d+ errors? today\.|\d+ warnings? today\./u);
        const clean = await cli(repository(FILES), ['init']);
        assert.match(
            clean.out,
            /^No crowded folders today \(2 folders checked\)\.\nNext: add `crowded-folders --format auto` to your CI/mu,
        );
        assert.doesNotMatch(clean.out, /"scripts"/u);
    });
});
