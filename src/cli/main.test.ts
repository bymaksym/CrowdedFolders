import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { cleanUpAfterTests, cli, repository } from './test-support/harness.ts';

cleanUpAfterTests();

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** What a person who ran the command caused: each of these is exit code 2 with the cause, never "this is a bug". */
const THEIR_ERRORS = new Set([
    'UsageError',
    'ConfigError',
    'GitError',
    'FileListError',
    'RuleError',
    'WriteError',
    'AgentsKitError',
    // A suppressions file that does not parse: the command makes it a UsageError, lint() hands it to the caller.
    'SuppressionsFileError',
]);

/**
 * The throws that are not theirs, each with why. `throw new Error` anywhere else is a failure of this test: either
 * it is something the user can cause (use one of THEIR_ERRORS) or it belongs here, saying why.
 */
const ALLOWED = [
    {
        file: 'node/modules.ts',
        why: 'resolveSpecifier says why a name cannot be found; loadPlugin and applyExtends turn it into a ConfigError',
    },
    {
        file: 'core/rules/guard.ts',
        why: 'a rule that writes to what it was given gets a TypeError, inside callRule, which makes it a RuleError for that rule',
    },
    {
        file: 'eslint.ts',
        why: 'ESLint shows the error of a rule that throws; this one carries what the child process printed, which is the message of the command itself',
    },
    {
        file: 'testing.ts',
        why: "RuleTestError is a failing test of a plugin's author, thrown inside their test runner, not the command",
    },
];

function sourcesIn(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'test-support' ? [] : sourcesIn(path);
        }
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? path : [];
    });
}

describe('every throw', () => {
    it('is something the user caused and says so, or is listed here with why it is not', () => {
        const unlisted: string[] = [];
        let seen = 0;
        for (const path of sourcesIn(SRC)) {
            const name = relative(SRC, path).replaceAll('\\', '/');
            const lines = readFileSync(path, 'utf8').split('\n');
            for (const [index, line] of lines.entries()) {
                const thrown = /(?:^\s*|[{};]\s*)throw\s+(?:new\s+)?([A-Z]\w*)/u.exec(line)?.[1];
                if (thrown === undefined || line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) {
                    continue;
                }
                seen++;
                if (!THEIR_ERRORS.has(thrown) && ALLOWED.every(allowed => allowed.file !== name)) {
                    unlisted.push(`${name}:${index + 1}: ${line.trim()}`);
                }
            }
        }
        assert.ok(seen > 20, `only ${seen} throws found: is the scan reading src?`);
        assert.deepEqual(unlisted, [], 'a throw that is not one of the errors the user causes');
    });
});

const RECOMMENDED = '{"extends":["recommended"]}';

/** Runs the command and checks it ended as the user's mistake, not as a bug. */
async function mistake(root: string, args: readonly string[], pattern: RegExp): Promise<string> {
    const ran = await cli(root, args);
    assert.equal(ran.code, 2, ran.err);
    assert.doesNotMatch(ran.err, /this is a bug|broke/u);
    assert.doesNotMatch(ran.err, /\n\s+at /u, 'no stack trace');
    assert.match(ran.err, pattern);
    return ran.err;
}

describe('what the user caused', () => {
    it('a JSON that does not close says where, with a path an editor links', async () => {
        const root = repository({
            'a.ts': '',
            'crowded-folders.config.json': '{\n    "extends": ["recommended"],\n    "exclude": [\n}',
        });
        const err = await mistake(root, [], /crowded-folders\.config\.json:4:1 {2}is not valid JSON/u);
        assert.equal(err.includes(root), false, 'the folder of the machine is not repeated');
        assert.match(err, /^crowded-folders: crowded-folders\.config\.json has a problem:/u);
    });

    it('an empty file, a package.json that is not JSON, and a configuration that is a folder', async () => {
        await mistake(
            repository({ 'a.ts': '', 'crowded-folders.config.json': '' }),
            [],
            /config\.json:1:1 {2}is not valid JSON/u,
        );
        const root = repository({ 'a.ts': '', 'package.json': '{ "name": ' });
        await mistake(root, ['--config', 'package.json'], /package\.json:1:11 {2}is not valid JSON/u);
        await mistake(repository({ 'a.ts': '', 'conf/x': '' }), ['--config', 'conf'], /cannot (be read|be loaded)/u);
    });

    it('two configurations in one folder', async () => {
        const root = repository({
            'a.ts': '',
            'crowded-folders.config.json': RECOMMENDED,
            'crowded-folders.config.mjs': 'export default {}',
        });
        await mistake(root, [], /more than one crowded-folders configuration/u);
    });

    it('a configuration in JavaScript that does not load or that throws', async () => {
        await mistake(
            repository({ 'a.ts': '', 'crowded-folders.config.mjs': 'export default {' }),
            [],
            /crowded-folders\.config\.mjs has a problem:\n.*cannot be loaded/u,
        );
        await mistake(
            repository({
                'a.ts': '',
                'crowded-folders.config.mjs': 'export default () => { throw new Error("no token"); };',
            }),
            [],
            /cannot be loaded: no token/u,
        );
    });

    it('a setting that is wrong says its line and column', async () => {
        const root = repository({
            'a.ts': '',
            'crowded-folders.config.json':
                '{\n    "extends": ["recommended"],\n    "rules": { "max-file": ["warn", { "max": 3 }] }\n}',
        });
        await mistake(root, [], /crowded-folders\.config\.json:3:16 {2}rules\["max-file"\]: is not a rule/u);
    });

    it('a report that cannot be written', async () => {
        const root = repository({ 'a.ts': '', 'crowded-folders.config.json': RECOMMENDED });
        await mistake(root, ['-f', 'json', '-o', 'a.ts/out.json'], /cannot write .*out\.json/u);
    });

    it('a report that cannot be written, where tidying up after it fails too (ENOTDIR on Linux)', async () => {
        // The temporary file's name is taken by a folder: writing fails, and so does removing what was never
        // written. On Linux `-o a.ts/out.json` is that same case, and it said "this is a bug".
        const root = repository({
            'a.ts': '',
            'crowded-folders.config.json': RECOMMENDED,
            [`out.json.${process.pid}.tmp/keep.txt`]: '',
        });
        await mistake(root, ['-f', 'json', '-o', 'out.json'], /cannot write .*out\.json/u);
        assert.ok(existsSync(join(root, `out.json.${process.pid}.tmp`, 'keep.txt')), 'what was there is left alone');
    });

    it('a rule of a plugin that throws', async () => {
        const plugin = `export default {
            meta: { namespace: 'boom', name: 'boom' },
            rules: { explode: { meta: { description: 'x', defaultOptions: {} }, check() { throw new Error('plugin bug'); } } },
        };`;
        const root = repository({
            'a.ts': '',
            'plugin.mjs': plugin,
            'crowded-folders.config.json':
                '{"plugins":["./plugin.mjs"],"extends":["recommended"],"rules":{"boom/explode":"error"}}',
        });
        await mistake(root, [], /boom\/explode failed in \.: plugin bug \(report it to boom\)/u);
    });
});
