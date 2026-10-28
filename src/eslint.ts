/**
 * `crowded-folders/eslint`: the analysis as an ESLint plugin (flat config, ESLint 9 and 10), so that
 * whatever runs ESLint sees it: editors, the ESLint MCP server, pre-commit hooks and oxlint's JS plugins.
 *
 * One rule, `crowded-folders/folder`. For each linted file it reports the findings of that file's folder,
 * once per folder: a folder is not a file, so the report is anchored at line 1 of the first linted file in
 * it. ESLint types are not imported: ESLint stays a development dependency of this package, and the
 * shapes below are the part of its rule API that is used.
 */
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** What the rule reads from ESLint's context. */
export interface FolderRuleContext {
    readonly filename: string;
    readonly cwd: string;
    readonly options: readonly unknown[];
    report(descriptor: {
        readonly loc: { readonly line: number; readonly column: number };
        readonly messageId: 'finding';
        readonly data: Readonly<Record<string, string>>;
    }): void;
}

/** The options of `crowded-folders/folder`. */
export interface FolderRuleOptions {
    /** A configuration file, from ESLint's working directory. Default: found upwards, as the command finds it. */
    readonly config?: string;
    /** Report only the findings the command fails on (severity `error`). Default: every finding. */
    readonly errorsOnly?: boolean;
}

/** The part of a finding the rule needs. */
interface FolderFinding {
    readonly folder: string;
    readonly rule: string;
    readonly severity: 'error' | 'warn';
    readonly message: string;
    readonly url: string | undefined;
}

interface Analysis {
    readonly root: string;
    readonly findings: readonly FolderFinding[];
}

/**
 * Runs in a child process: ESLint rules are synchronous and loading a configuration (and its plugins)
 * is not. The child makes a linter with the public API, runs it once over the repository's files and
 * prints what the rule needs.
 */
const CHILD = `
const [entry, cwd, config] = process.argv.slice(1);
try {
    const { createLinter } = await import(entry);
    const linter = await createLinter({ cwd, ...(config === '' ? {} : { config }) });
    const result = linter.lint({ suppressions: true });
    const findings = result.kept.map(({ folder, rule, severity, message, url }) => ({ folder, rule, severity, message, url }));
    process.stdout.write(JSON.stringify({ root: result.root, findings }));
} catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
}
`;

const analyses = new Map<string, Analysis>();

function analyse(cwd: string, config: string | undefined): Analysis {
    const key = `${cwd}\0${config ?? ''}`;
    let analysis = analyses.get(key);
    if (analysis === undefined) {
        const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
        const entry = new URL(`index${extension}`, import.meta.url).href;
        const child = spawnSync(
            process.execPath,
            ['--input-type=module', '--eval', CHILD, entry, cwd, config === undefined ? '' : resolve(cwd, config)],
            { cwd, encoding: 'utf8', maxBuffer: 1 << 28 },
        );
        if (child.error !== undefined || child.status !== 0) {
            const why = child.error?.message ?? child.stderr.trim();
            throw new Error(`crowded-folders could not analyse ${cwd}: ${why}`);
        }
        analysis = JSON.parse(child.stdout) as Analysis;
        analyses.set(key, analysis);
    }
    return analysis;
}

/** Forgets what was analysed: the next linted file analyses the repository again. For tests and long-lived tools. */
export function resetAnalyses(): void {
    analyses.clear();
    reporters.clear();
}

/** Which file reported each folder: the first linted one, which keeps reporting it if it is linted again. */
const reporters = new Map<string, string>();

function folderOf(root: string, filename: string): string | undefined {
    if (!isAbsolute(filename)) {
        return undefined; // '<input>', '<text>': code that is not a file of the repository
    }
    const path = relative(root, filename);
    if (path === '' || path.startsWith('..') || isAbsolute(path)) {
        return undefined;
    }
    const folder = dirname(path).split(sep).join('/');
    return folder;
}

export const folderRule = {
    meta: {
        type: 'suggestion' as const,
        docs: {
            description: 'Report the folders of the repository that crowded-folders finds crowded.',
            url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/eslint.md',
        },
        schema: [
            {
                type: 'object' as const,
                properties: {
                    config: { type: 'string' as const },
                    errorsOnly: { type: 'boolean' as const },
                },
                additionalProperties: false,
            },
        ],
        messages: { finding: '{{message}} [{{rule}}]{{url}}' },
    },
    create(context: FolderRuleContext): { Program(): void } {
        return {
            Program() {
                const options = (context.options[0] ?? {}) as FolderRuleOptions;
                const { root, findings } = analyse(context.cwd, options.config);
                const folder = folderOf(root, context.filename);
                if (folder === undefined) {
                    return;
                }
                const reporterKey = `${root}\0${options.config ?? ''}\0${folder}`;
                const reporter = reporters.get(reporterKey);
                if (reporter !== undefined && reporter !== context.filename) {
                    return;
                }
                const here = findings.filter(
                    finding =>
                        finding.folder === folder && (options.errorsOnly !== true || finding.severity === 'error'),
                );
                if (here.length === 0) {
                    return;
                }
                reporters.set(reporterKey, context.filename);
                for (const finding of here) {
                    context.report({
                        loc: { line: 1, column: 0 },
                        messageId: 'finding',
                        data: {
                            message: finding.message,
                            rule: finding.rule,
                            url: finding.url === undefined ? '' : ` ${finding.url}`,
                        },
                    });
                }
            },
        };
    },
};

/** A flat config object: what `recommended` is, and what a plugin's `configs` hold. */
export interface FlatConfig {
    readonly name: string;
    readonly plugins: Readonly<Record<string, CrowdedFoldersPlugin>>;
    readonly rules: Readonly<Record<string, 'error' | 'warn' | 'off'>>;
}

export interface CrowdedFoldersPlugin {
    readonly meta: { readonly name: string };
    readonly rules: { readonly folder: typeof folderRule };
    readonly configs: { readonly recommended: FlatConfig };
}

const configs = {} as { recommended: FlatConfig };

/** `import crowdedFolders from 'crowded-folders/eslint'`: `rules.folder` and `configs.recommended`. */
const plugin: CrowdedFoldersPlugin = {
    meta: { name: 'crowded-folders' },
    rules: { folder: folderRule },
    configs,
};
configs.recommended = {
    name: 'crowded-folders/recommended',
    plugins: { 'crowded-folders': plugin },
    rules: { 'crowded-folders/folder': 'error' },
};

export default plugin;
