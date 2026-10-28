import { folderLabel } from './describe.ts';
import type { ReportFinding } from './report.ts';

export type GroupBy = 'folder' | 'owner' | 'project';

export interface Group {
    readonly title: string;
    readonly findings: readonly ReportFinding[];
}

/** How many groups the overview lists. */
export const TOP_GROUPS = 10;

/**
 * Splits the findings into the groups a person reads them by. By folder, the way they come (sorted by
 * folder). By project or owner, the groups with the most problems first: 8,000 flat lines do not say
 * which package is the worst, and an unowned problem is one nobody will fix.
 */
export function groupFindings(findings: readonly ReportFinding[], by: GroupBy): Group[] {
    if (by === 'folder') {
        const groups: { title: string; findings: ReportFinding[] }[] = [];
        for (const finding of findings) {
            const last = groups.at(-1);
            if (last?.title === folderTitle(finding.folder)) {
                last.findings.push(finding);
            } else {
                groups.push({ title: folderTitle(finding.folder), findings: [finding] });
            }
        }
        return groups;
    }
    const byTitle = new Map<string, ReportFinding[]>();
    for (const finding of findings) {
        const title = titleOf(finding, by);
        const list = byTitle.get(title);
        if (list) list.push(finding);
        else byTitle.set(title, [finding]);
    }
    return [...byTitle]
        .map(([title, list]) => ({ title, findings: list }))
        .toSorted(
            (a, b) =>
                errorsOf(b.findings) - errorsOf(a.findings) ||
                b.findings.length - a.findings.length ||
                (a.title < b.title ? -1 : 1),
        );
}

/** The overview lines: the worst groups with their counts. */
export function overview(groups: readonly Group[], noun: string): string[] {
    if (groups.length < 2) {
        return [];
    }
    const lines = [`Top ${Math.min(TOP_GROUPS, groups.length)} ${noun}`];
    const width = Math.max(...groups.slice(0, TOP_GROUPS).map(group => group.title.length));
    for (const group of groups.slice(0, TOP_GROUPS)) {
        const errors = errorsOf(group.findings);
        const warnings = group.findings.length - errors;
        lines.push(
            `  ${group.title.padEnd(width)}  ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
        );
    }
    if (groups.length > TOP_GROUPS) {
        lines.push(`  … and ${groups.length - TOP_GROUPS} more`);
    }
    return lines;
}

function errorsOf(findings: readonly ReportFinding[]): number {
    return findings.filter(finding => finding.severity === 'error').length;
}

function folderTitle(folder: string): string {
    return folder === '.' ? '. (the root)' : `${folder}/`;
}

function titleOf(finding: ReportFinding, by: 'owner' | 'project'): string {
    if (by === 'project') {
        return finding.project === undefined || finding.project === null
            ? '(no project)'
            : finding.project === '.'
              ? '. (the root project)'
              : folderLabel(finding.project);
    }
    return finding.owners && finding.owners.length > 0 ? finding.owners.join(' ') : '(no owner)';
}
