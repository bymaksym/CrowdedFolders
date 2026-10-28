/**
 * The programmatic API: what a plugin, a shared configuration or a script imports.
 *
 * Everything exported here is public and versioned; anything else under `dist/` is not importable
 * (package.json `exports` closes it). `crowded-folders/engine` is the part of it that needs no Node,
 * and `crowded-folders/testing` the `RuleTester`.
 */
export type { StaleSuppression } from './core/suppressions.ts';
export * from './engine.ts';
export { GitError } from './node/files.ts';
export {
    createLinter,
    lint,
    type Linter,
    type LinterOptions,
    type LintOptions,
    type LintResult,
    type LintRun,
} from './node/linter.ts';
export { SuppressionsFileError } from './node/suppressions-files.ts';
