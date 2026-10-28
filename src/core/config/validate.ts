import { splitWords } from '../naming/words.ts';
import { globProblem } from '../paths/glob.ts';
import { parseMirror } from '../paths/mirrors.ts';
import { suggest } from '../paths/suggest.ts';
import type { Rule } from '../rules/rule.ts';
import { isObject, validate } from './json-schema.ts';
import { configSchema, MIN_REASON_LENGTH } from './schema.ts';
import type { Config, NamingConfig, RuleSetting } from './types.ts';

export interface ConfigProblem {
    readonly at: string;
    readonly message: string;
    /** Where in the file it is (from 1), when the reader of the file knows; else found from `at`. */
    readonly line?: number;
    readonly column?: number;
}

/** A configuration that cannot be used, with every problem found in it. */
export class ConfigError extends Error {
    readonly origin: string;
    readonly problems: readonly ConfigProblem[];

    constructor(origin: string, problems: readonly ConfigProblem[]) {
        super(
            `${origin} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:\n${formatProblems(problems)}`,
        );
        this.name = 'ConfigError';
        this.origin = origin;
        this.problems = problems;
    }
}

export interface ValidateOptions {
    /**
     * The plugins are not loaded yet: a `namespace/rule` nobody defines is left for the check after
     * they load, so that a configuration is read in full before any of its code runs.
     */
    readonly pluginsPending?: boolean;
}

/** ESLint's numbers for severities, which a configuration here writes as words. */
const ESLINT_SEVERITIES: Readonly<Record<number, string>> = { 0: 'off', 1: 'warn', 2: 'error' };

/**
 * Checks a configuration as it was written, before anything is merged: the shape against the
 * published schema, then what a schema cannot say — that the regular expressions compile, that the
 * globs are globs, that every rule exists and that every reason is one.
 *
 * `rules` must already include the plugins' rules (unless `pluginsPending`); a rule the
 * configuration names that no one defines is an error, not a silence.
 */
export function validateConfig(
    value: unknown,
    rules: Readonly<Record<string, Rule>>,
    presets: readonly string[],
    options: ValidateOptions = {},
): ConfigProblem[] {
    const problems: ConfigProblem[] = withEslintSeverities(value, validate(value, configSchema(rules, presets)));
    if (problems.length > 0 || !isObject(value)) {
        return problems;
    }
    const config = value as Config;
    checkGlobs(config.include, 'include', problems);
    checkGlobs(config.exclude, 'exclude', problems);
    checkNaming(config.naming, 'naming', problems);
    checkRules(config.rules, 'rules', rules, problems, options);
    for (const [index, override] of (config.overrides ?? []).entries()) {
        const at = `overrides[${index}]`;
        checkFolderGlobs(override.folders, `${at}.folders`, problems);
        checkFolderGlobs(override.withFiles, `${at}.withFiles`, problems);
        checkNaming(override.naming, `${at}.naming`, problems);
        checkRules(override.rules, `${at}.rules`, rules, problems, options);
        checkReason(override.reason, `${at}.reason`, problems);
        checkDate(override.expires, `${at}.expires`, problems);
    }
    return problems;
}

/**
 * `"max-files": 2` is ESLint's habit: the schema would only say "must be one of…", and this says
 * what 2 is here. Its problems replace the schema's for the same setting.
 */
function withEslintSeverities(value: unknown, problems: readonly ConfigProblem[]): ConfigProblem[] {
    if (!isObject(value)) {
        return [...problems];
    }
    const found: { readonly setting: string; readonly problem: ConfigProblem }[] = [];
    const scan = (settings: unknown, at: string): void => {
        if (!isObject(settings)) {
            return;
        }
        for (const [name, setting] of Object.entries(settings)) {
            const severity: unknown = Array.isArray(setting) ? (setting as readonly unknown[])[0] : setting;
            if (typeof severity !== 'number') {
                continue;
            }
            const word = ESLINT_SEVERITIES[severity];
            const where = `${at}[${JSON.stringify(name)}]`;
            found.push({
                setting: where,
                problem: {
                    at: Array.isArray(setting) ? `${where}[0]` : where,
                    message:
                        word === undefined
                            ? `is ${severity}: a severity is "error", "warn" or "off"`
                            : `is ${severity}, ESLint's number for "${word}": write "${word}" (severities are words here: "error", "warn", "off")`,
                },
            });
        }
    };
    scan(value['rules'], 'rules');
    const overrides = value['overrides'];
    if (Array.isArray(overrides)) {
        for (const [index, override] of (overrides as readonly unknown[]).entries()) {
            if (isObject(override)) {
                scan(override['rules'], `overrides[${index}].rules`);
            }
        }
    }
    if (found.length === 0) {
        return [...problems];
    }
    const isReplaced = (at: string): boolean =>
        found.some(({ setting }) => at === setting || at.startsWith(`${setting}[`));
    return [...problems.filter(problem => !isReplaced(problem.at)), ...found.map(({ problem }) => problem)];
}

/** A reason is trimmed, and has to be long enough to be one: `" "` and `"x"` used to turn rules off. */
function checkReason(reason: string, at: string, problems: ConfigProblem[]): void {
    const trimmed = reason.trim();
    if (trimmed.length >= MIN_REASON_LENGTH) {
        return;
    }
    problems.push({
        at,
        message: `${trimmed === '' ? 'is blank' : `is ${JSON.stringify(trimmed)}`}: say why these folders are different, in at least ${MIN_REASON_LENGTH} characters once trimmed — it is what a reviewer reads a year from now`,
    });
}

/** The schema says the shape (YYYY-MM-DD); this says it is a day of the calendar. */
function checkDate(date: string | undefined, at: string, problems: ConfigProblem[]): void {
    if (date === undefined) {
        return;
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        problems.push({ at, message: `"${date}" is not a day of the calendar (YYYY-MM-DD)` });
    }
}

/** The globs of an override: `!` is not a negation there, and used to be ignored in silence. */
function checkFolderGlobs(globs: readonly string[] | undefined, at: string, problems: ConfigProblem[]): void {
    for (const [index, glob] of (globs ?? []).entries()) {
        if (glob.startsWith('!')) {
            problems.push({
                at: `${at}[${index}]`,
                message: `"${glob}": "!" does not leave folders out here; an override applies to every folder its globs match, so name the ones it is for`,
            });
            continue;
        }
        const problem = globProblem(glob);
        if (problem) {
            problems.push({ at: `${at}[${index}]`, message: `"${glob}" ${problem}` });
        }
    }
}

function checkGlobs(globs: readonly string[] | undefined, at: string, problems: ConfigProblem[]): void {
    for (const [index, glob] of (globs ?? []).entries()) {
        const problem = globProblem(glob.startsWith('!') ? glob.slice(1) : glob);
        if (problem) {
            problems.push({ at: `${at}[${index}]`, message: `"${glob}" ${problem}` });
        }
    }
}

function checkNaming(naming: NamingConfig | undefined, at: string, problems: ConfigProblem[]): void {
    for (const [index, pattern] of (naming?.companions ?? []).entries()) {
        if (pattern.startsWith('!')) {
            continue;
        }
        try {
            new RegExp(pattern, 'u');
        } catch (error) {
            problems.push({
                at: `${at}.companions[${index}]`,
                message: `"${pattern}" is not a regular expression: ${(error as Error).message}`,
            });
        }
    }
    // Read the way names are read, or the entry never matches: "useState" is two words, "use" and "state".
    for (const [index, entry] of (naming?.ignoreLeadingWords ?? []).entries()) {
        const word = entry.startsWith('!') ? entry.slice(1) : entry;
        const words = splitWords(word);
        if (words.length === 1 && words[0] === word.toLowerCase()) {
            continue;
        }
        const suggestion = `${entry.startsWith('!') ? '!' : ''}${words[0] ?? ''}`;
        problems.push({
            at: `${at}.ignoreLeadingWords[${index}]`,
            message:
                words.length === 0
                    ? `"${entry}" has no words, so it never matches`
                    : `"${entry}" is not one word: names are split at "-", "_", "." and case changes, and it reads as ${words.map(part => `"${part}"`).join(', ')} — did you mean "${suggestion}"?`,
        });
    }
    checkGlobs(naming?.folderFiles, `${at}.folderFiles`, problems);
    checkGlobs(naming?.keepInPlace, `${at}.keepInPlace`, problems);
    for (const [index, entry] of (naming?.mirrors ?? []).entries()) {
        const mirror = entry.startsWith('!') ? undefined : parseMirror(entry);
        if (typeof mirror === 'string') {
            problems.push({ at: `${at}.mirrors[${index}]`, message: `"${entry}" ${mirror}` });
        }
    }
}

function checkRules(
    settings: Readonly<Record<string, RuleSetting>> | undefined,
    at: string,
    rules: Readonly<Record<string, Rule>>,
    problems: ConfigProblem[],
    options: ValidateOptions,
): void {
    for (const [name, setting] of Object.entries(settings ?? {})) {
        const where = `${at}[${JSON.stringify(name)}]`;
        const rule = rules[name];
        if (!rule) {
            if (options.pluginsPending && name.includes('/')) {
                continue;
            }
            const known = Object.keys(rules);
            const meant = suggest(name, known);
            const hint = name.includes('/')
                ? `no plugin in "plugins" defines it (known: ${known.join(', ')})`
                : `known rules: ${known.filter(rule => !rule.includes('/')).join(', ')}`;
            problems.push({
                at: where,
                message: `is not a rule; ${meant === undefined ? '' : `did you mean "${meant}"? `}${hint}`,
            });
            continue;
        }
        if (typeof setting === 'string' || setting[1] === undefined || !rule.meta.options) {
            continue;
        }
        const shape = validate(setting[1], rule.meta.options, `${where}[1]`);
        problems.push(...shape);
        if (shape.length === 0 && rule.meta.checkOptions) {
            for (const problem of rule.meta.checkOptions(setting[1])) {
                problems.push({ at: `${where}[1].${problem.at}`, message: problem.message });
            }
        }
    }
}

export function formatProblems(problems: readonly ConfigProblem[]): string {
    return problems.map(problem => `  ${problem.at}: ${problem.message}`).join('\n');
}
