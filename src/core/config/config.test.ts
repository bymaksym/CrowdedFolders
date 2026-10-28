import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUILT_IN_PRESETS } from '../presets/index.ts';
import { BUILT_IN_RULES } from '../rules/index.ts';
import { validate } from './json-schema.ts';
import { duplicateKeys, parseJsonc, stripJsonc } from './jsonc.ts';
import { applySetting, mergeLayer, mergeList } from './merge.ts';
import { configSchema } from './schema.ts';
import { globFromAbove, globUnder } from './scope.ts';
import { EMPTY_CONFIG } from './types.ts';
import { validateConfig } from './validate.ts';

const presets = Object.keys(BUILT_IN_PRESETS);
const problemsOf = (value: unknown) => validateConfig(value, BUILT_IN_RULES, presets);

describe('parseJsonc', () => {
    it('reads comments and trailing commas, and leaves strings alone', () => {
        const text = `{
            // a reason
            "a": "// not a comment", /* block
            comment */ "b": [1, 2,],
            "c": "\\"/*\\"",
        }`;
        assert.deepEqual(parseJsonc(text), { a: '// not a comment', b: [1, 2], c: '"/*"' });
    });

    it('keeps line numbers, so JSON errors point at the right line', () => {
        const stripped = stripJsonc('{\n/* one\ntwo */\n"a": 1\n}');
        assert.equal(stripped.split('\n').length, 5);
        assert.throws(() => parseJsonc('{\n// x\n"a": }'), SyntaxError);
    });

    it('skips a byte order mark', () => {
        assert.deepEqual(parseJsonc('\u{FEFF}{"a":1}'), { a: 1 });
    });
});

describe('duplicateKeys', () => {
    it('finds a key written twice in one object, where JSON keeps the second in silence (two "rules")', () => {
        const text = `{
            "rules": { "max-files": "error" },
            // "rules" again, further down
            "overrides": [{ "folders": ["a"], "reason": "r", "folders": ["b"] }],
            "rules": { "max-files": "off" },
            "x": { "rules": 1 }, "y": { "rules": 2 }
        }`;
        assert.deepEqual(duplicateKeys(text), [
            { at: 'overrides[0]', key: 'folders', lines: [4, 4] },
            { at: '', key: 'rules', lines: [2, 5] },
        ]);
        assert.deepEqual(duplicateKeys('{"a": "\\"a\\"", "b": {"a": 1}}'), []);
    });
});

describe('mergeList', () => {
    it('appends without repeating and removes "!x"', () => {
        assert.deepEqual(mergeList(['a', 'b'], ['b', 'c', '!a']), ['b', 'c']);
        assert.deepEqual(mergeList(['a'], undefined), ['a']);
    });
});

describe('applySetting', () => {
    it('keeps options under a bare severity, and merges them under a tuple', () => {
        const first = applySetting(undefined, ['error', { max: 10, ignore: ['use'] }]);
        assert.deepEqual(applySetting(first, 'warn'), { severity: 'warn', options: { max: 10, ignore: ['use'] } });
        assert.deepEqual(applySetting(first, ['error', { ignore: ['test', '!use'] }]), {
            severity: 'error',
            options: { max: 10, ignore: ['test'] },
        });
        assert.deepEqual(applySetting(undefined, ['warn']), { severity: 'warn', options: {} });
    });
});

describe('mergeLayer', () => {
    it('accumulates lists, keeps the last scalar, and records where overrides came from', () => {
        const base = mergeLayer(
            EMPTY_CONFIG,
            {
                exclude: ['vendor'],
                naming: { companions: ['_test$'], ignoreLeadingWords: ['I'] },
                suppressions: 'a.json',
            },
            'preset "x"',
            false,
        );
        const merged = mergeLayer(
            base,
            {
                exclude: ['!vendor', 'build'],
                naming: { groupNumericPrefixes: true },
                overrides: [{ folders: ['a'], reason: 'r' }],
            },
            'mine.json',
            true,
        );
        assert.deepEqual(merged.exclude, ['build']);
        assert.deepEqual(merged.naming, {
            companions: ['_test$'],
            ignoreLeadingWords: ['i'],
            groupNumericPrefixes: true,
            folderFiles: [],
            folderCompanions: [],
        });
        assert.equal(merged.suppressions, 'a.json');
        assert.deepEqual(merged.layers, ['preset "x"', 'mine.json']);
        assert.equal(merged.overrides[0]?.own, true);
        assert.equal(merged.overrides[0]?.origin, 'mine.json');
    });
});

describe('validateConfig', () => {
    it('accepts an empty configuration and a full one', () => {
        assert.deepEqual(problemsOf({}), []);
        assert.deepEqual(
            problemsOf({
                $schema: 'x',
                extends: ['recommended', './base.json'],
                plugins: ['crowded-folders-plugin-x'],
                include: ['src/**'],
                exclude: ['fixtures'],
                naming: { companions: ['_test$'], ignoreLeadingWords: ['i'], groupNumericPrefixes: false },
                rules: { 'max-files': ['error', { max: 10, count: 'modules' }], 'prefix-groups': 'warn' },
                overrides: [{ folders: ['src/legacy'], reason: 'being rewritten', rules: { 'max-files': 'off' } }],
                suppressions: 'suppressions.json',
            }),
            [],
        );
    });

    it('requires a reason on every override', () => {
        const problems = problemsOf({ overrides: [{ folders: ['a'], rules: { 'max-files': 'off' } }] });
        assert.deepEqual(problems, [{ at: 'overrides[0]', message: 'needs "reason"' }]);
        assert.match(
            problemsOf({ overrides: [{ folders: ['a'], reason: '' }] })[0]?.message ?? '',
            /at least 10 characters/u,
        );
    });

    it('trims a reason and asks for 10 characters: " " and "x" turned max-files off (Daniel, Irina)', () => {
        const blank = problemsOf({
            overrides: [{ folders: ['a'], reason: ' '.repeat(11), rules: { 'max-files': 'off' } }],
        });
        assert.deepEqual(
            blank.map(problem => problem.at),
            ['overrides[0].reason'],
        );
        assert.match(blank[0]?.message ?? '', /is blank: say why/u);
        const short = problemsOf({ overrides: [{ folders: ['a'], reason: '  x        ' }] });
        assert.match(short[0]?.message ?? '', /is "x": say why these folders are different, in at least 10/u);
        assert.deepEqual(problemsOf({ overrides: [{ folders: ['a'], reason: 'Generated from the spec' }] }), []);
        const merged = mergeLayer(
            EMPTY_CONFIG,
            { overrides: [{ folders: ['a'], reason: '  Generated from the spec \n' }] },
            'mine.json',
            true,
        );
        assert.equal(merged.overrides[0]?.reason, 'Generated from the spec');
    });

    it('rejects "!" in folders, which looked like a negation and was ignored (folders: ["!src/lib"])', () => {
        const problems = problemsOf({
            overrides: [{ folders: ['src/**', '!src/lib'], withFiles: ['!x.json'], reason: 'the source is generated' }],
        });
        assert.deepEqual(
            problems.map(problem => problem.at),
            ['overrides[0].folders[1]', 'overrides[0].withFiles[0]'],
        );
        assert.match(problems[0]?.message ?? '', /"!" does not leave folders out here/u);
    });

    it('takes expires, owner and ticket, and checks that expires is a day (expires was "not a known setting")', () => {
        const override = {
            folders: ['src/legacy'],
            reason: 'being rewritten in v3',
            owner: '@acme/web',
            ticket: 'WEB-12',
        };
        assert.deepEqual(problemsOf({ overrides: [{ ...override, expires: '2027-03-31' }] }), []);
        assert.match(
            problemsOf({ overrides: [{ ...override, expires: '2027-02-30' }] })[0]?.message ?? '',
            /not a day of the calendar/u,
        );
        assert.match(
            problemsOf({ overrides: [{ ...override, expires: '31/03/2027' }] })[0]?.message ?? '',
            /must match/u,
        );
    });

    it('says what an ESLint number means as a severity ("max-files": 2)', () => {
        assert.deepEqual(problemsOf({ rules: { 'max-files': 2 } }), [
            {
                at: 'rules["max-files"]',
                message:
                    'is 2, ESLint\'s number for "error": write "error" (severities are words here: "error", "warn", "off")',
            },
        ]);
        const [tuple] = problemsOf({
            overrides: [
                { folders: ['a'], reason: 'a reason long enough', rules: { 'prefix-groups': [1, { min: 3 }] } },
            ],
        });
        assert.equal(tuple?.at, 'overrides[0].rules["prefix-groups"][0]');
        assert.match(tuple?.message ?? '', /ESLint's number for "warn"/u);
    });

    it('suggests the rule, the severity and the option value that were meant (max-file, "warning", "module")', () => {
        assert.match(problemsOf({ rules: { 'max-file': 'error' } })[0]?.message ?? '', /did you mean "max-files"\?/u);
        assert.match(problemsOf({ rules: { 'max-files': 'warning' } })[0]?.message ?? '', /did you mean "warn"\?/u);
        assert.match(
            problemsOf({ rules: { 'max-files': ['error', { count: 'module' }] } })[0]?.message ?? '',
            /not "module"; did you mean "modules"\?/u,
        );
    });

    it('names the setting that is wrong, and suggests the one that was meant', () => {
        assert.deepEqual(problemsOf({ exlude: ['a'] }), [
            { at: 'exlude', message: 'is not a known setting; did you mean "exclude"?' },
        ]);
        const [problem] = problemsOf({ rules: { 'max-files': ['error', { max: 0 }] } });
        assert.equal(problem?.at, 'rules["max-files"][1].max');
        assert.match(problem?.message ?? '', /at least 1/u);
        assert.match(problemsOf({ rules: { 'max-files': 'loud' } })[0]?.message ?? '', /"error", "warn", "off"/u);
    });

    it('rejects a rule nobody defines, a regular expression that does not compile and a broken glob', () => {
        assert.match(
            problemsOf({ rules: { 'max-file': 'error' } })[0]?.message ?? '',
            /not a rule; did you mean "max-files"\? known rules: max-files/u,
        );
        assert.match(problemsOf({ rules: { 'x/y': 'error' } })[0]?.message ?? '', /no plugin/u);
        assert.match(
            problemsOf({ naming: { companions: ['(unclosed'] } })[0]?.message ?? '',
            /not a regular expression/u,
        );
        assert.match(problemsOf({ exclude: ['src/{a'] })[0]?.message ?? '', /leaves a "\{" open/u);
        assert.match(problemsOf({ naming: { ignoreLeadingWords: ['two words'] } })[0]?.message ?? '', /not one word/u);
    });
});

describe('configSchema', () => {
    it('is valid draft-07 in the subset this package writes, and describes every built-in rule', () => {
        const schema = configSchema(BUILT_IN_RULES, presets);
        assert.equal(schema.$schema, 'https://json-schema.org/draft-07/schema#');
        assert.deepEqual(
            Object.keys(schema.properties?.['rules']?.properties ?? {}).toSorted((a, b) => a.localeCompare(b)),
            Object.keys(BUILT_IN_RULES).toSorted((a, b) => a.localeCompare(b)),
        );
        assert.deepEqual(validate({ rules: { 'max-files': ['error', { max: 3 }] } }, schema), []);
    });
});

describe('globUnder', () => {
    it('reads the globs of a preset applied under a folder from that folder (react under web/**)', () => {
        assert.equal(globUnder('web', 'public'), 'web/**/public');
        assert.equal(globUnder('server', '/target'), 'server/target');
        assert.equal(globUnder('server', '**/src/test'), 'server/**/src/test');
        assert.equal(globUnder('apps/*', 'src/app/**'), 'apps/*/src/app/**');
        assert.equal(globUnder('web', '.'), 'web');
        assert.equal(globUnder('web', '!dist'), '!web/**/dist');
        assert.equal(globUnder('', '/target'), '/target');
    });
});

describe('globFromAbove', () => {
    it('reads the globs of a base.json at the top from a package below it (Daniel)', () => {
        assert.deepEqual(globFromAbove('packages/a', 'packages/*/src/**'), { kind: 'glob', glob: 'src/**' });
        assert.deepEqual(globFromAbove('packages/a', 'packages/a/legacy'), { kind: 'glob', glob: '/legacy' });
        assert.deepEqual(globFromAbove('packages/a', 'packages/b/**'), { kind: 'outside' });
        assert.deepEqual(globFromAbove('packages/a', 'packages/**/gen'), { kind: 'glob', glob: '**/gen' });
        assert.deepEqual(globFromAbove('packages/a', 'generated'), { kind: 'glob', glob: 'generated' });
        assert.deepEqual(globFromAbove('packages/a', '/packages'), { kind: 'base' });
        assert.deepEqual(globFromAbove('packages/a', 'packages/a'), { kind: 'base' });
        assert.deepEqual(globFromAbove('packages/a', '.'), { kind: 'outside' });
        assert.deepEqual(globFromAbove('packages/a', '!packages/a/x'), { kind: 'glob', glob: '!/x' });
    });
});
