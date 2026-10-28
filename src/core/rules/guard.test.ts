import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { schemaProblems } from '../config/json-schema.ts';
import { mergeLayer } from '../config/merge.ts';
import { type Config, EMPTY_CONFIG } from '../config/types.ts';
import { runEngine } from '../engine.ts';
import { attributeRuleError, frozenCopy, reportProblem, RuleError, ruleShapeProblem } from './guard.ts';
import { BUILT_IN_RULES } from './index.ts';
import { defineRule, type Rule } from './rule.ts';

const configOf = (config: Config) => mergeLayer(EMPTY_CONFIG, config, 'test', true);

/** Runs one plugin rule, named `acme/<name>`, with `recommended`'s prefix-groups beside it when asked. */
function runWith(name: string, rule: Rule, files: readonly string[], config: Config = {}) {
    return runEngine({
        files,
        config: configOf({ ...config, rules: { ...config.rules, [`acme/${name}`]: 'error' } }),
        rules: { ...BUILT_IN_RULES, [`acme/${name}`]: rule },
    });
}

const meta = { description: 'test', defaultOptions: {} };

describe('a rule that breaks', () => {
    it('is named, with its folder, instead of "crowded-folders broke"', () => {
        const boom = defineRule({
            meta,
            check(folder) {
                if (folder.path === 'src') throw new Error('Cannot read properties of undefined');
            },
        });
        assert.throws(
            () => runWith('boom', boom, ['src/a.ts']),
            (error: unknown) => {
                assert.ok(error instanceof RuleError);
                assert.equal(error.rule, 'acme/boom');
                assert.equal(error.folder, 'src');
                assert.equal(error.message, 'acme/boom failed in src: Cannot read properties of undefined');
                return true;
            },
        );
    });

    it('says which package to report it to, once the plugins are known', () => {
        const error = new RuleError('acme/boom', 'src', 'x is not a function');
        const plugins = [{ meta: { name: 'crowded-folders-plugin-acme', namespace: 'acme' } }];
        assert.equal(
            attributeRuleError(error, plugins).message,
            'acme/boom failed in src: x is not a function (report it to crowded-folders-plugin-acme)',
        );
        // A built-in rule has no plugin: it stays as it is, and the command calls it a bug of its own.
        const builtIn = new RuleError('max-files', 'src', 'oops');
        assert.equal(attributeRuleError(builtIn, plugins), builtIn);
    });

    it('is an error when check returns a promise: what it reports after would be lost', () => {
        const late = defineRule({
            meta,
            check(_folder, { report }) {
                const later = async (): Promise<void> => {
                    await Promise.resolve();
                    report({ message: 'too late' });
                };
                return later() as unknown as undefined;
            },
        });
        assert.throws(() => runWith('late', late, ['a.ts']), /acme\/late failed in \.: check must be synchronous/u);
    });

    it('refuses an async check when the plugin loads, before any folder', () => {
        assert.match(
            ruleShapeProblem({
                meta,
                async check() {
                    await Promise.resolve();
                },
            }) ?? '',
            /check must be synchronous/u,
        );
    });

    it('is an error to report after check returned (from a timer)', () => {
        let saved: ((problem: { message: string }) => void) | undefined;
        const keeps = defineRule({
            meta,
            check(_folder, { report }) {
                saved = report;
            },
        });
        runWith('keeps', keeps, ['a.ts']);
        assert.throws(() => saved?.({ message: 'x' }), /after check returned/u);
    });
});

describe('what a rule reports', () => {
    it('is checked before it reaches SARIF and annotations (measured -5, files ../../etc/passwd)', () => {
        assert.equal(reportProblem({ message: 'ok', measured: 3, limit: 2, files: ['a.ts', 'sub/b.ts'] }), undefined);
        assert.match(reportProblem({ message: 'x', measured: -5 }) ?? '', /measured must be a number of at least 0/u);
        assert.match(reportProblem({ message: 'x', measured: NaN }) ?? '', /measured/u);
        assert.match(reportProblem({ message: 'x', limit: -1 }) ?? '', /limit/u);
        assert.match(reportProblem({ message: 'x', files: ['../../etc/passwd'] }) ?? '', /climbs out/u);
        assert.match(reportProblem({ message: 'x', files: ['/etc/passwd'] }) ?? '', /absolute/u);
        assert.match(reportProblem({ message: 'x', files: [String.raw`C:\x`] }) ?? '', /absolute/u);
        assert.match(reportProblem({ message: 'x', files: ['a//b'] }) ?? '', /empty/u);
        assert.match(reportProblem({ message: 'x', moves: [{ from: 'a', to: '../b' }] }) ?? '', /move's to/u);
        assert.match(reportProblem({ message: '' }) ?? '', /needs a message/u);
        assert.match(reportProblem({ message: 'x', key: 3 }) ?? '', /key must be a string/u);
        assert.match(reportProblem('x') ?? '', /takes an object/u);
    });

    it('stops the run with the rule and the folder when it is wrong', () => {
        const escapes = defineRule({
            meta,
            check(folder, { report }) {
                report({ message: 'look', files: ['../../etc/passwd'], measured: folder.files.length });
            },
        });
        assert.throws(
            () => runWith('escapes', escapes, ['src/a.ts']),
            /acme\/escapes failed in \.: report\(\): files has "\.\.\/\.\.\/etc\/passwd"/u,
        );
    });
});

describe('state shared between folders and runs', () => {
    it('a rule that adds to naming.ignoreLeadingWords throws instead of silencing prefix-groups elsewhere', () => {
        const meddles = defineRule({
            meta,
            check(folder) {
                (folder.naming.ignoreLeadingWords as Set<string>).add('render');
            },
        });
        const files = ['a/render-json.ts', 'a/render-text.ts', 'a/render-pr.ts', 'a/render-sarif.ts', 'a/main.ts'];
        assert.throws(
            () => runWith('meddles', meddles, files, { rules: { 'prefix-groups': 'error' } }),
            /acme\/meddles failed in \.: this set is read-only/u,
        );
        // And the run without it still finds the group: nothing was changed.
        const clean = runEngine({
            files,
            config: configOf({ rules: { 'prefix-groups': 'error' } }),
            rules: BUILT_IN_RULES,
        });
        assert.deepEqual(
            clean.findings.map(finding => finding.key),
            ['render'],
        );
    });

    it('a rule that pushes to its options throws, so nothing carries over to the next folder or call', () => {
        const seen = defineRule({
            meta: { description: 'test', defaultOptions: { seen: [] as string[] } },
            check(folder, { options }) {
                options.seen.push(folder.path);
            },
        });
        assert.throws(() => runWith('seen', seen, ['a/x.ts']), /acme\/seen failed in \.: Cannot add property 0/u);
        // The defaults themselves were never touched.
        assert.deepEqual(seen.meta.defaultOptions.seen, []);
    });

    it('folders and their modules are frozen, so one rule cannot reorder what the next one reads', () => {
        const sorts = defineRule({
            meta,
            check(folder) {
                (folder.files as string[]).reverse();
            },
        });
        assert.throws(
            () => runWith('sorts', sorts, ['b.ts', 'a.ts']),
            /acme\/sorts failed in \.: Cannot assign to read only property/u,
        );
    });

    it('built-in rules change nothing they are given: run as plugins, on frozen views, they report the same', () => {
        // The engine skips freezing where only built-in rules run (it cost a tenth of a run); this is
        // what makes that safe. A copy of a rule is not built in, so it gets frozen views.
        const files = [
            ...['render-json', 'render-text', 'render-pr', 'render-sarif', 'main'].map(name => `src/${name}.ts`),
            ...Array.from({ length: 25 }, (_, index) => `big/file-${index}.ts`),
            'src/render/render-x.ts',
            'src/render/render-y.ts',
            'lone/only.ts',
            'case/Foo.ts',
            'case/foo.ts',
            'app/controller/OrderController.ts',
            'app/service/OrderService.ts',
            'app/model/Order.ts',
            'art/icon.png.import',
            'art/Textures/rock.png',
        ];
        const everyRule = Object.fromEntries(Object.keys(BUILT_IN_RULES).map(name => [name, 'error' as const]));
        const config = configOf({ rules: { ...everyRule, 'max-folders': ['error', { max: 3 }] } });
        const copies = Object.fromEntries(Object.entries(BUILT_IN_RULES).map(([name, rule]) => [name, { ...rule }]));
        const plain = runEngine({ files, config, rules: BUILT_IN_RULES });
        assert.deepEqual(
            new Set(plain.findings.map(finding => finding.rule)),
            new Set(Object.keys(BUILT_IN_RULES)),
            'every built-in rule fires here',
        );
        assert.deepEqual(runEngine({ files, config, rules: copies }).findings, plain.findings);
    });

    it('frozenCopy copies lists and plain objects all the way down, and leaves the original alone', () => {
        const original = { a: [1, { b: [2] }], c: /x/u };
        const copy = frozenCopy(original);
        assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.a) && Object.isFrozen(copy.a[1]));
        assert.equal(copy.c, original.c);
        assert.ok(!Object.isFrozen(original.a));
    });
});

describe('rules with create (tree rules)', () => {
    // A rule about the tree: `render.ts` next to a `render/` folder, which a per-folder rule sees
    // only from the parent, and how deep the tree goes, which only the end of the run knows.
    const deepest = defineRule({
        meta: { description: 'deepest folder', defaultOptions: { max: 2 } },
        create({ report }) {
            let deepestPath = '.';
            let depth = 0;
            let max = 2;
            return {
                folder(folder, { options }) {
                    max = options.max;
                    if (folder.depth <= depth) {
                        return;
                    }

                    depth = folder.depth;
                    deepestPath = folder.path;
                },
                done() {
                    if (depth > max) {
                        report({ folder: deepestPath, message: `${depth} folders deep`, measured: depth, limit: max });
                    }
                },
            };
        },
    });

    it('sees every folder, then reports from done with the severity of that folder', () => {
        const result = runWith('deepest', deepest, ['a/b/c/d.ts', 'x.ts']);
        assert.deepEqual(
            result.findings.map(finding => `${finding.rule} ${finding.folder} ${finding.measured}`),
            ['acme/deepest a/b/c 3'],
        );
    });

    it('makes a new visitor on each run, so nothing is kept from the previous one', () => {
        assert.equal(runWith('deepest', deepest, ['a/b/c/d.ts']).findings.length, 1);
        assert.equal(runWith('deepest', deepest, ['a/b.ts']).findings.length, 0);
    });

    it('reports nothing in a folder where it is off, and refuses a folder the run did not look at', () => {
        const off = runWith('deepest', deepest, ['a/b/c/d.ts'], {
            overrides: [{ folders: ['a/b/c'], reason: 'generated', rules: { 'acme/deepest': 'off' } }],
        });
        assert.deepEqual(off.findings, []);
        const elsewhere = defineRule({
            meta,
            create: ({ report }) => ({
                done() {
                    report({ folder: 'nowhere', message: 'x' });
                },
            }),
        });
        assert.throws(() => runWith('elsewhere', elsewhere, ['a.ts']), /did not look at/u);
    });

    it('needs exactly one of check and create', () => {
        assert.match(
            ruleShapeProblem({ meta, check: () => 0, create: () => ({}) }) ?? '',
            /both "check" and "create"/u,
        );
        assert.equal(ruleShapeProblem({ meta, create: () => ({}) }), undefined);
    });
});

describe('the schema of a rule', () => {
    it('lists the keywords the validator would skip: oneOf, exclusiveMinimum, $ref', () => {
        assert.deepEqual(schemaProblems({ type: 'object', properties: { max: { type: 'integer', minimum: 1 } } }), []);
        const problems = schemaProblems({
            type: 'object',
            properties: { max: { type: 'number', exclusiveMinimum: 0 }, mode: { oneOf: [{ const: 'a' }] } },
            additionalProperties: { $ref: '#/definitions/x' },
        });
        assert.equal(problems.length, 3);
        assert.match(problems[0] ?? '', /options\.properties\.max uses "exclusiveMinimum"/u);
        assert.match(problems[1] ?? '', /options\.properties\.mode uses "oneOf"/u);
        assert.match(problems[2] ?? '', /additionalProperties uses "\$ref"/u);
        assert.match(schemaProblems({ type: 'strin' })[0] ?? '', /not a JSON Schema type/u);
        assert.match(schemaProblems({ type: 'string', pattern: '(' })[0] ?? '', /does not compile/u);
    });

    it('is refused when the rule loads, and so are defaults that do not fit it', () => {
        assert.match(
            ruleShapeProblem({
                meta: { ...meta, options: { type: 'object', properties: { n: { oneOf: [] } } } },
                check: () => 0,
            }) ?? '',
            /uses "oneOf"/u,
        );
        assert.match(
            ruleShapeProblem({
                meta: {
                    description: 'd',
                    defaultOptions: { n: 'x' },
                    options: { type: 'object', properties: { n: { type: 'integer' } } },
                },
                check: () => 0,
            }) ?? '',
            /its own defaults do not fit its schema/u,
        );
    });

    it('holds for every built-in rule', () => {
        for (const [name, rule] of Object.entries(BUILT_IN_RULES)) {
            assert.equal(ruleShapeProblem(rule), undefined, name);
        }
    });
});
