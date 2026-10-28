/**
 * A rule from a plugin threw while it checked a folder. The plugin is the user's choice and its bug is not
 * ours: this stops the run (exit code 2) with the rule and the folder, instead of "this is a bug, report it".
 */
export class RuleError extends Error {
    readonly rule: string;
    readonly folder: string;

    constructor(rule: string, folder: string, cause: unknown) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        super(
            `the rule "${rule}" threw while checking ${folder === '.' ? 'the root folder' : folder}: ${reason}\nIt comes from a plugin: report it to its author, or turn it off with "${rule}": "off".`,
            { cause },
        );
        this.name = 'RuleError';
        this.rule = rule;
        this.folder = folder;
    }
}
