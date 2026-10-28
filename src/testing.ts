/**
 * `crowded-folders/testing`: a `RuleTester` for the rules of a plugin, as ESLint has one. Pure, like
 * the engine: it runs in any test runner, and throws a `RuleTestError` on the first case that fails.
 */
import { type Resolution, resolveConfig } from './core/config/resolve.ts';
import type { Config, Plugin, RuleSetting } from './core/config/types.ts';
import { type Finding, runEngine } from './core/engine.ts';
import { normaliseFileList } from './core/paths/input.ts';
import { buildTree } from './core/paths/tree.ts';
import { ruleShapeProblem } from './core/rules/guard.ts';
import type { Move, Rule } from './core/rules/rule.ts';

/** A case: a repository as a list of paths, and the rule's options in it. */
export interface RuleTestCase {
    /** What the case shows, for the message when it fails. */
    readonly name?: string;
    /** The files of the repository, relative to its root. */
    readonly files: readonly string[];
    /** The rule's options, as a configuration sets them; checked against its schema. */
    readonly options?: Readonly<Record<string, unknown>>;
    /** More configuration: naming, overrides, other rules. The rule tested is on, as `"error"`. */
    readonly config?: Config;
}

/** A problem a case expects. Only what is given is compared. */
export interface ExpectedProblem {
    readonly folder: string;
    /** The message, or a pattern it matches. */
    readonly message?: string | RegExp;
    readonly key?: string;
    readonly measured?: number;
    readonly limit?: number;
    /** Paths relative to the root, as findings have them. */
    readonly files?: readonly string[];
    readonly moves?: readonly Move[];
}

export interface InvalidRuleTestCase extends RuleTestCase {
    /** The problems, in the order findings are sorted (by folder, then key); or how many. */
    readonly errors: readonly ExpectedProblem[] | number;
}

export interface RuleTests {
    /** Repositories where the rule reports nothing. */
    readonly valid?: readonly (RuleTestCase | readonly string[])[];
    /** Repositories where it reports exactly `errors`. */
    readonly invalid?: readonly InvalidRuleTestCase[];
}

export interface RuleTesterOptions {
    /** Configuration every case starts from (a case's `config` goes over it). Default: none, only the rule. */
    readonly config?: Config;
    /** Plugins whose rules and presets the configurations name. */
    readonly plugins?: readonly Plugin[];
}

/** A case that did not hold, or a rule that is not one. */
export class RuleTestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuleTestError';
    }
}

type TestHook = (name: string, run: () => void) => unknown;

/**
 * Runs a rule over cases and checks, besides what each case expects, what every rule must be:
 *
 * - a rule: `meta` with a description and defaults, one of `check` and `create`, not `async`, and an
 *   options schema whose every keyword is checked, with defaults that fit it;
 * - synchronous: a `check` that returns a promise fails;
 * - pure: the same case run twice gives the same findings, and (for `check` rules) what it reports in a
 *   folder is what it reports when that folder is checked alone — nothing depends on the folders
 *   before it, nor on a previous run. Options and folders are frozen, so a rule that changes them throws.
 *
 * With `RuleTester.describe` and `RuleTester.it` set (to `node:test`'s, or a runner's), each case is
 * a test of its own; otherwise `run` runs them all and throws on the first that fails.
 */
export class RuleTester {
    static describe: TestHook | undefined;
    static it: TestHook | undefined;

    private readonly options: RuleTesterOptions;

    constructor(options: RuleTesterOptions = {}) {
        this.options = options;
    }

    run(name: string, rule: Rule, tests: RuleTests): void {
        const all = (): void => {
            const problem = ruleShapeProblem(rule);
            if (problem !== undefined) {
                throw new RuleTestError(`${name} is not a valid rule: it ${problem}`);
            }
            const cases = [
                ...(tests.valid ?? []).map((test, index) => ({
                    test: caseOf(test),
                    label: `valid[${index}]`,
                    errors: 0 as const,
                })),
                ...(tests.invalid ?? []).map((test, index) => ({
                    test,
                    label: `invalid[${index}]`,
                    errors: test.errors,
                })),
            ];
            for (const { test, label, errors } of cases) {
                const run = (): void => {
                    this.runCase(
                        name,
                        rule,
                        test,
                        errors,
                        `${name} ${label}${test.name === undefined ? '' : ` (${test.name})`}`,
                    );
                };
                if (RuleTester.it) {
                    RuleTester.it(`${label}${test.name === undefined ? '' : `: ${test.name}`}`, run);
                } else {
                    run();
                }
            }
        };
        if (RuleTester.describe && RuleTester.it) {
            RuleTester.describe(name, all);
        } else {
            all();
        }
    }

    private runCase(
        name: string,
        rule: Rule,
        test: RuleTestCase,
        errors: readonly ExpectedProblem[] | number,
        label: string,
    ): void {
        const setting: RuleSetting = test.options === undefined ? 'error' : ['error', test.options];
        const base = { ...this.options.config, ...test.config };
        const config: Config = { ...base, rules: { ...base.rules, [name]: setting } };
        let resolved: Resolution;
        try {
            resolved = resolveConfig(config, {
                rules: { [name]: rule },
                ...(this.options.plugins && { plugins: this.options.plugins }),
                origin: label,
            });
        } catch (error) {
            throw new RuleTestError(`${label}: the configuration does not load: ${(error as Error).message}`);
        }
        const once = (only?: readonly string[]): Finding[] => {
            try {
                const result = runEngine({ files: test.files, ...resolved, ...(only && { only }) });
                return result.findings.filter(finding => finding.rule === name);
            } catch (error) {
                throw new RuleTestError(`${label}: ${(error as Error).message}`);
            }
        };
        const findings = once();
        const again = once();
        if (JSON.stringify(again) !== JSON.stringify(findings)) {
            throw new RuleTestError(
                `${label}: the second run reported something else than the first, so the rule keeps state between runs.\n  first:  ${shown(findings)}\n  second: ${shown(again)}`,
            );
        }
        if (rule.check) {
            for (const entry of buildTree(normaliseFileList(test.files).files)) {
                const alone = once([entry.path]).filter(finding => finding.folder === entry.path);
                const within = findings.filter(finding => finding.folder === entry.path);
                if (JSON.stringify(alone) !== JSON.stringify(within)) {
                    throw new RuleTestError(
                        `${label}: in ${entry.path} it reports something else when that folder is checked alone, so it keeps state between folders.\n  with the others: ${shown(within)}\n  alone:           ${shown(alone)}`,
                    );
                }
            }
        }
        compare(label, findings, errors);
    }
}

function caseOf(test: RuleTestCase | readonly string[]): RuleTestCase {
    return isFileList(test) ? { files: test } : test;
}

function isFileList(test: RuleTestCase | readonly string[]): test is readonly string[] {
    return Array.isArray(test);
}

function compare(label: string, findings: readonly Finding[], errors: readonly ExpectedProblem[] | number): void {
    const expected = typeof errors === 'number' ? errors : errors.length;
    if (findings.length !== expected) {
        throw new RuleTestError(
            `${label}: expected ${expected} problem${expected === 1 ? '' : 's'}, got ${findings.length}: ${shown(findings)}`,
        );
    }
    if (typeof errors === 'number') {
        return;
    }
    for (const [index, want] of errors.entries()) {
        const got = findings[index];
        if (!got) {
            continue;
        }
        const differences: string[] = [];
        if (got.folder !== want.folder)
            differences.push(`folder ${JSON.stringify(got.folder)}, not ${JSON.stringify(want.folder)}`);
        if (want.message !== undefined) {
            const matches =
                typeof want.message === 'string' ? got.message === want.message : want.message.test(got.message);
            if (!matches) differences.push(`message ${JSON.stringify(got.message)}, not ${String(want.message)}`);
        }
        for (const field of ['key', 'measured', 'limit'] as const) {
            if (want[field] !== undefined && got[field] !== want[field]) {
                differences.push(`${field} ${JSON.stringify(got[field])}, not ${JSON.stringify(want[field])}`);
            }
        }
        for (const field of ['files', 'moves'] as const) {
            if (want[field] !== undefined && JSON.stringify(got[field]) !== JSON.stringify(want[field])) {
                differences.push(`${field} ${JSON.stringify(got[field])}, not ${JSON.stringify(want[field])}`);
            }
        }
        if (differences.length > 0) {
            throw new RuleTestError(`${label}: problem ${index} has ${differences.join('; ')}`);
        }
    }
}

function shown(findings: readonly Finding[]): string {
    return findings.length === 0
        ? 'none'
        : findings
              .map(
                  finding =>
                      `${finding.folder}${finding.key === undefined ? '' : `#${finding.key}`}: ${finding.message}`,
              )
              .join(' | ');
}
