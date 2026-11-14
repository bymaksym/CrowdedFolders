import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUILT_IN_RULES } from './core/rules/index.ts';
import { defineRule } from './engine.ts';
import { RuleTester, RuleTestError } from './testing.ts';

const genericNames = defineRule({
    meta: {
        description: 'no utils',
        defaultOptions: { names: ['utils'] },
        options: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } } },
    },
    check(folder, { options, report }) {
        if (options.names.includes(folder.name)) {
            report({ message: `"${folder.name}" says nothing`, files: folder.files });
        }
    },
});

const tester = new RuleTester();
const fails = (run: () => void, pattern: RegExp): void => {
    assert.throws(run, (error: unknown) => {
        assert.ok(error instanceof RuleTestError, String(error));
        assert.match(error.message, pattern);
        return true;
    });
};

describe('RuleTester', () => {
    it('passes a rule that reports what each case expects', () => {
        tester.run('acme/generic-names', genericNames, {
            valid: [['src/user/a.ts'], { files: ['src/helpers/a.ts'], options: { names: ['common'] } }],
            invalid: [
                {
                    name: 'a utils folder',
                    files: ['src/utils/a.ts', 'src/user/b.ts'],
                    errors: [{ folder: 'src/utils', message: /says nothing/u, files: ['src/utils/a.ts'] }],
                },
                { files: ['a/utils/x.ts', 'b/utils/y.ts'], errors: 2 },
            ],
        });
    });

    it('runs a built-in rule too', () => {
        tester.run('max-files', BUILT_IN_RULES['max-files']!, {
            invalid: [
                {
                    files: ['a/1.ts', 'a/2.ts', 'a/3.ts'],
                    options: { max: 2 },
                    errors: [{ folder: 'a', measured: 3, limit: 2 }],
                },
            ],
        });
    });

    it('says what differs from what the case expects', () => {
        fails(() => {
            tester.run('acme/generic-names', genericNames, {
                invalid: [{ name: 'wrong folder', files: ['src/utils/a.ts'], errors: [{ folder: 'src' }] }],
            });
        }, /acme\/generic-names invalid\[0\] \(wrong folder\): problem 0 has folder "src\/utils", not "src"/u);
        fails(() => {
            tester.run('acme/generic-names', genericNames, { valid: [['src/utils/a.ts']] });
        }, /valid\[0\]: expected 0 problems, got 1/u);
    });

    it('fails a rule that keeps state between runs', () => {
        let runs = 0;
        const counter = defineRule({
            meta: { description: 'x', defaultOptions: {} },
            check(folder, { report }) {
                if (folder.path === '.') runs++;
                if (runs % 2 === 1 && folder.path === '.') report({ message: 'odd run' });
            },
        });
        fails(() => {
            tester.run('acme/counter', counter, { valid: [['a.ts']] });
        }, /keeps state between runs/u);
    });

    it('fails a rule that keeps state between folders', () => {
        const firstOnly = defineRule({
            meta: { description: 'x', defaultOptions: {} },
            check(folder, { report }) {
                // Reports the first folder of each run, whichever it is: what it says depends on the others.
                if (!seen.has(folder.path) && seen.size === 0) report({ message: 'first' });
                seen.add(folder.path);
            },
        });
        const seen = new Set<string>();
        fails(() => {
            seen.clear();
            tester.run('acme/first', firstOnly, { invalid: [{ files: ['src/a.ts'], errors: 1 }] });
        }, /keeps state/u);
    });

    it('fails what is not a valid rule: async, an unchecked schema keyword, bad options in a case', () => {
        const meta = { description: 'x', defaultOptions: {} };
        fails(() => {
            tester.run(
                'acme/a',
                {
                    meta: { description: 'x', defaultOptions: {} },
                    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async on purpose: the tester must refuse it
                    check: async (): Promise<void> => {
                        await Promise.resolve();
                    },
                },
                {},
            );
        }, /^acme\/a is not a valid rule: it has an async check: check must be synchronous/u);
        fails(() => {
            tester.run(
                'acme/s',
                { meta: { ...meta, options: { type: 'object', oneOf: [] } }, check: () => 0 } as never,
                {},
            );
        }, /uses "oneOf"/u);
        fails(() => {
            tester.run('acme/generic-names', genericNames, {
                valid: [{ files: ['a.ts'], options: { names: 'utils' } }],
            });
        }, /the configuration does not load: .*must be a list/su);
    });

    it('fails a rule that changes what it is given', () => {
        const mutates = defineRule({
            meta: { description: 'x', defaultOptions: { seen: [] as string[] } },
            check(folder, { options }) {
                options.seen.push(folder.path);
            },
        });
        fails(() => {
            tester.run('acme/mutates', mutates, { valid: [['a.ts']] });
        }, /acme\/mutates failed in \.: Cannot add property/u);
    });

    it('makes each case a test of its own with describe and it set', () => {
        const names: string[] = [];
        RuleTester.describe = (name, run) => {
            names.push(`describe ${name}`);
            run();
        };
        RuleTester.it = (name, run) => {
            names.push(`it ${name}`);
            run();
        };
        try {
            tester.run('acme/generic-names', genericNames, {
                valid: [['a.ts']],
                invalid: [{ name: 'utils', files: ['utils/a.ts'], errors: 1 }],
            });
        } finally {
            RuleTester.describe = undefined;
            RuleTester.it = undefined;
        }
        assert.deepEqual(names, ['describe acme/generic-names', 'it valid[0]', 'it invalid[0]: utils']);
    });
});
