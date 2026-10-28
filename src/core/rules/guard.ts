import { isObject, schemaProblems, validate } from '../config/json-schema.ts';
import { isAbsolutePath } from '../paths/input.ts';

/**
 * A rule that broke: it threw, returned a promise, or reported something that is not a problem. It is
 * the rule's fault, not the run's, so the message names the rule, the folder and, for a plugin rule,
 * the package to report it to — never "crowded-folders broke".
 */
export class RuleError extends Error {
    /** The rule, as a configuration names it: `acme/no-generic-names`. */
    readonly rule: string;
    /** The folder it was looking at; `undefined` when it broke before or after the folders. */
    readonly folder: string | undefined;
    /** The package of the plugin the rule comes from, when known; `undefined` for a built-in rule. */
    readonly plugin: string | undefined;
    /** What went wrong, without the rule and the folder. */
    readonly problem: string;

    constructor(
        rule: string,
        folder: string | undefined,
        problem: string,
        options: { readonly cause?: unknown; readonly plugin?: string | undefined } = {},
    ) {
        const where = folder === undefined ? '' : ` in ${folder}`;
        const plugin = options.plugin === undefined ? '' : ` (report it to ${options.plugin})`;
        super(
            `${rule} failed${where}: ${problem}${plugin}`,
            options.cause === undefined ? {} : { cause: options.cause },
        );
        this.name = 'RuleError';
        this.rule = rule;
        this.folder = folder;
        this.plugin = options.plugin;
        this.problem = problem;
    }
}

/** The same error with the package of the plugin that defines its rule, found by namespace. */
export function attributeRuleError(
    error: RuleError,
    plugins: readonly { readonly meta: { readonly name: string; readonly namespace: string } }[],
): RuleError {
    const slash = error.rule.indexOf('/');
    if (error.plugin !== undefined || slash === -1) {
        return error;
    }
    const namespace = error.rule.slice(0, slash);
    const plugin = plugins.find(candidate => candidate.meta.namespace === namespace)?.meta.name;
    return plugin === undefined
        ? error
        : new RuleError(error.rule, error.folder, error.problem, { cause: error.cause, plugin });
}

/** The message of anything thrown. */
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one call into a rule: what it throws becomes a `RuleError` for that rule and folder, and a
 * promise is an error too. An `async` rule would report after the run has returned its findings, so
 * what it found would be lost without a word.
 */
export function callRule(rule: string, folder: string | undefined, run: () => unknown): void {
    let returned: unknown;
    try {
        returned = run();
    } catch (error) {
        throw error instanceof RuleError ? error : new RuleError(rule, folder, messageOf(error), { cause: error });
    }
    if (!isThenable(returned)) {
        return;
    }

    // Whatever it rejects with later is the same failure, already reported.
    returned.then(undefined, ignore);
    throw new RuleError(rule, folder, ASYNC_PROBLEM);
}

/** What a promise of a rule rejects with later: the same failure, reported once already. */
function ignore(): void {
    // Nothing to do.
}

const ASYNC_PROBLEM =
    'check must be synchronous: it returned a promise, and what it reports once that settles would be lost. Rules see names only, so there is nothing to await.';

function isThenable(
    value: unknown,
): value is { then: (resolve: unknown, reject: (error: unknown) => void) => unknown } {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

/**
 * What is wrong with what a rule passed to `report()`, or `undefined` when it is a problem. What a
 * rule reports reaches SARIF, annotations and suppressions, so a negative count or a path that climbs
 * out of the folder (`../../etc/passwd`) stops the run instead of reaching them.
 */
export function reportProblem(problem: unknown): string | undefined {
    if (!isObject(problem)) {
        return `report() takes an object, not ${problem === null ? 'null' : typeof problem}`;
    }
    if (typeof problem['message'] !== 'string' || problem['message'].trim() === '') {
        return 'report() needs a message';
    }
    if (problem['key'] !== undefined && typeof problem['key'] !== 'string') {
        return 'report(): key must be a string';
    }
    for (const field of ['measured', 'limit'] as const) {
        const value = problem[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
            return `report(): ${field} must be a number of at least 0, not ${shown(value)}`;
        }
    }
    const files = problem['files'];
    if (files !== undefined) {
        if (!Array.isArray(files)) {
            return 'report(): files must be a list of names';
        }
        for (const file of files as unknown[]) {
            const issue = pathIssue(file);
            if (issue !== undefined) {
                return `report(): files has ${shown(file)}, which ${issue}: they are names inside the folder`;
            }
        }
    }
    const moves = problem['moves'];
    if (moves !== undefined) {
        if (!Array.isArray(moves)) {
            return 'report(): moves must be a list of { from, to }';
        }
        for (const move of moves as unknown[]) {
            if (!isObject(move)) {
                return 'report(): each move is { from, to }';
            }
            for (const end of ['from', 'to'] as const) {
                const issue = pathIssue(move[end]);
                if (issue !== undefined) {
                    return `report(): a move's ${end} is ${shown(move[end])}, which ${issue}: moves are paths relative to the root`;
                }
            }
        }
    }
    return undefined;
}

/** A value as a message shows it: JSON, or its type when JSON has no text for it. */
function shown(value: unknown): string {
    const text = JSON.stringify(value) as string | undefined;
    return text ?? typeof value;
}

/** Why a path is not a relative path that stays where it starts, or `undefined` when it is one. */
function pathIssue(path: unknown): string | undefined {
    if (typeof path !== 'string' || path === '') {
        return 'is not a name';
    }
    if (isAbsolutePath(path)) {
        return 'is absolute';
    }
    for (const segment of path.split('/')) {
        if (['', '.', '..'].includes(segment)) {
            return segment === '..' ? 'climbs out with ".."' : 'has an empty or "." segment';
        }
    }
    return undefined;
}

/**
 * What is wrong with a value that should be a rule, or `undefined` when it is one: `meta` with a
 * description and default options, exactly one of `check` and `create`, neither of them `async`, and
 * an options schema whose every keyword is checked.
 */
export function ruleShapeProblem(rule: unknown): string | undefined {
    if (!isObject(rule) || !isObject(rule['meta'])) {
        return 'needs a "meta" object';
    }
    const meta = rule['meta'];
    if (typeof meta['description'] !== 'string' || !isObject(meta['defaultOptions'])) {
        return 'needs meta.description and meta.defaultOptions';
    }
    if (meta['url'] !== undefined && typeof meta['url'] !== 'string') {
        return 'meta.url must be a string';
    }
    const check = rule['check'];
    const create = rule['create'];
    if ((typeof check === 'function') === (typeof create === 'function')) {
        return typeof check === 'function'
            ? 'has both "check" and "create": give it one of them'
            : 'needs a "check" function (or "create", for a rule about the tree)';
    }
    const entry = (typeof check === 'function' ? check : create) as (...args: never[]) => unknown;
    if (isAsync(entry)) {
        return `${typeof check === 'function' ? 'check' : 'create'} must be synchronous: an async rule reports after the run has returned, and what it finds is lost`;
    }
    if (meta['options'] !== undefined) {
        const problems = schemaProblems(meta['options'], 'meta.options');
        if (problems.length > 0) {
            return problems.join('; ');
        }
        const defaults = validate(meta['defaultOptions'], meta['options'] as never, 'meta.defaultOptions');
        if (defaults.length > 0) {
            return `its own defaults do not fit its schema: ${defaults.map(problem => `${problem.at} ${problem.message}`).join('; ')}`;
        }
    }
    return undefined;
}

function isAsync(fn: (...args: never[]) => unknown): boolean {
    const kind = fn.constructor.name;
    return kind === 'AsyncFunction' || kind === 'AsyncGeneratorFunction';
}

/**
 * A copy of a value that cannot be changed, lists and plain objects all the way down. Options and
 * folders are shared between rules and folders: a rule that pushed into `options.seen` or added to
 * `naming.ignoreLeadingWords` would change what every later folder, rule and run sees.
 */
export function frozenCopy<T>(value: T): T {
    if (Array.isArray(value)) {
        return Object.freeze(value.map(item => frozenCopy(item as unknown))) as T;
    }
    if (isPlainObject(value)) {
        const copy: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            copy[key] = frozenCopy(item);
        }
        return Object.freeze(copy) as T;
    }
    return value;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
}

/** A set nobody can change after it is made: `naming.ignoreLeadingWords`, which every folder shares. */
export class ReadOnlySet<T> extends Set<T> {
    constructor(values: Iterable<T>) {
        super();
        for (const value of values) {
            super.add(value);
        }
        Object.freeze(this);
    }

    override add(): this {
        throw new TypeError(READ_ONLY);
    }

    override delete(): boolean {
        throw new TypeError(READ_ONLY);
    }

    override clear(): void {
        throw new TypeError(READ_ONLY);
    }
}

const READ_ONLY =
    'this set is read-only: it is shared by every folder, so a rule that changed it would change what the others see';
