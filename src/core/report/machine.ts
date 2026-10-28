import { limitOf, plainMessage } from './describe.ts';
import { type Report, totalsOf } from './report.ts';

export { type AnnotationOptions, formatAzure, formatGithub } from './annotations.ts';
export { formatCheckstyle } from './checkstyle.ts';
export { formatGitlab } from './gitlab.ts';
export { formatMarkdown, type MarkdownOptions } from './markdown.ts';
export { formatSarif } from './sarif.ts';

/** The version of the JSON shape. A field added keeps it; a field renamed or removed raises it. */
export const FORMAT_VERSION = 1;

export interface JsonOptions {
    /** Leave out `files` and `moves` of each finding (`--no-files`): on a big repository they are most of the report. */
    readonly files?: boolean;
}

/**
 * The report as JSON: a stable shape for scripts, described by `report.schema.json`. Adding a field
 * is a minor change; renaming or removing one is major and raises `formatVersion`.
 */
export function formatJson(report: Report, options: JsonOptions = {}): string {
    const totals = totalsOf(report.findings);
    const withFiles = options.files ?? true;
    return `${JSON.stringify(
        {
            formatVersion: FORMAT_VERSION,
            tool: report.tool,
            ...(report.run && { run: report.run }),
            summary: {
                errors: totals.errors,
                warnings: totals.warnings,
                foldersWithProblems: totals.folders,
                foldersChecked: report.folderCount,
                filesChecked: report.fileCount,
                suppressed: report.suppressedCount,
            },
            findings: report.findings.map(finding => ({
                rule: finding.rule,
                severity: finding.severity,
                folder: finding.folder,
                message: plainMessage(report, finding),
                key: finding.key ?? null,
                measured: finding.measured,
                ...limitOf(finding),
                fileCount: finding.files.length,
                ...(withFiles && { files: finding.files, moves: finding.moves }),
                url: finding.url ?? null,
                project: finding.project ?? null,
                owners: finding.owners ?? [],
            })),
            staleSuppressions: report.staleSuppressions.map(stale => ({
                ...stale,
                measured: stale.measured ?? null,
            })),
            ...(report.folderStats && { folders: report.folderStats }),
        },
        undefined,
        2,
    )}\n`;
}
