import { anchors, staleAnchor } from './anchor.ts';
import { describe, describeStale, STALE_SUPPRESSION_RULE } from './describe.ts';
import type { Report } from './report.ts';
import { safe } from './sanitize.ts';

/**
 * Checkstyle XML, which Jenkins warnings-ng, reviewdog, Danger and SonarQube read: one `<file>` per
 * anchor, one `<error>` per finding.
 */
export function formatCheckstyle(report: Report): string {
    const anchorOf = anchors(report);
    const byFile = new Map<string, { line: number; severity: string; message: string; source: string }[]>();
    const add = (path: string, entry: { line: number; severity: string; message: string; source: string }): void => {
        const list = byFile.get(path);
        if (list) list.push(entry);
        else byFile.set(path, [entry]);
    };
    for (const finding of report.findings) {
        const anchor = anchorOf(finding);
        add(anchor.path, {
            line: anchor.line,
            severity: finding.severity === 'error' ? 'error' : 'warning',
            message: describe(report, finding),
            source: `crowded-folders.${finding.rule}`,
        });
    }
    for (const stale of report.staleSuppressions) {
        const anchor = staleAnchor(report, stale);
        add(anchor.path, {
            line: anchor.line,
            severity: 'error',
            message: describeStale(stale),
            source: `crowded-folders.${STALE_SUPPRESSION_RULE}`,
        });
    }
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<checkstyle version="4.3">'];
    for (const [path, entries] of byFile) {
        lines.push(`  <file name="${xml(path)}">`);
        for (const entry of entries) {
            lines.push(
                `    <error line="${entry.line}" severity="${entry.severity}" message="${xml(entry.message)}" source="${xml(entry.source)}"/>`,
            );
        }
        lines.push('  </file>');
    }
    lines.push('</checkstyle>');
    return `${lines.join('\n')}\n`;
}

function xml(text: string): string {
    return safe(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
