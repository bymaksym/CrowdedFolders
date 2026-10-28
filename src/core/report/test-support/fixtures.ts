import type { Finding } from '../../engine.ts';
import type { Report, ReportFinding } from '../report.ts';

/** A group of modules that should be a folder, the way the rule reports it. */
export const prefixGroup: Finding = {
    rule: 'prefix-groups',
    severity: 'error',
    folder: 'src/cli',
    message: '4 modules start with "render" (render-json, render-text, render-sarif, render-pr): a folder.',
    key: 'render',
    measured: 4,
    limit: 3,
    files: ['src/cli/render-json.ts', 'src/cli/render-pr.ts', 'src/cli/render-sarif.ts', 'src/cli/render-text.ts'],
    moves: [{ from: 'src/cli/render-json.ts', to: 'src/cli/render/render-json.ts' }],
    url: 'https://example.com/docs/rules/prefix-groups.md',
};

export const tooManyFiles: Finding = {
    rule: 'max-files',
    severity: 'warn',
    folder: 'src/components',
    message: '34 modules, over the limit of 20: split it into folders by what the files are about.',
    key: undefined,
    measured: 34,
    limit: 20,
    files: ['src/components/button.ts', 'src/components/card.ts'],
    moves: [],
    url: 'https://example.com/docs/rules/max-files.md',
};

export const tooManyFolders: Finding = {
    rule: 'max-folders',
    severity: 'warn',
    folder: 'src/features',
    message: '34 subfolders, over the limit of 30 (account, admin, analytics, billing, catalog and 29 more).',
    key: undefined,
    measured: 34,
    limit: 30,
    files: [],
    moves: [],
    url: 'https://example.com/docs/rules/max-folders.md',
};

export const unusedOverride: Finding = {
    rule: 'config/unused-override',
    severity: 'warn',
    folder: '.',
    message:
        'The override for "legacy/**" in C:\\Users\\ci\\work\\repo\\crowded-folders.config.json matches no folder ("old code"): remove it, or fix its globs.',
    key: 'legacy/**',
    measured: 1,
    limit: 0,
    files: [],
    moves: [],
    url: undefined,
};

export const rules = [
    {
        id: 'max-files',
        description: 'A folder holds at most `max` modules.',
        url: 'https://example.com/docs/rules/max-files.md',
    },
    {
        id: 'max-folders',
        description: 'A folder holds at most `max` subfolders.',
        url: 'https://example.com/docs/rules/max-folders.md',
    },
    {
        id: 'prefix-groups',
        description: 'Modules that share a prefix are a folder.',
        url: 'https://example.com/docs/rules/prefix-groups.md',
    },
];

export function report(findings: readonly ReportFinding[], extra: Partial<Report> = {}): Report {
    return {
        tool: { name: 'crowded-folders', version: '1.2.3', url: 'https://example.com' },
        findings,
        suppressedCount: 0,
        staleSuppressions: [],
        folderCount: 10,
        fileCount: 100,
        rules,
        ...extra,
    };
}
