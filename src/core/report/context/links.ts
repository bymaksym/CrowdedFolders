import type { ReportFinding } from '../report.ts';

/** Wraps a text in an OSC 8 hyperlink, which terminals that support it make clickable. */
export function hyperlink(text: string, url: string): string {
    const stringTerminator = '\u{1B}\\';
    return `\u{1B}]8;;${url}${stringTerminator}${text}\u{1B}]8;;${stringTerminator}`;
}

/**
 * Where each rule that appears in the findings is documented, for a footer when the terminal cannot
 * show links: `max-files  https://…`. Empty when no finding names a documented rule.
 */
export function ruleFooter(findings: readonly ReportFinding[]): string[] {
    const urls = new Map<string, string>();
    for (const finding of findings) {
        if (finding.url !== undefined && !urls.has(finding.rule)) {
            urls.set(finding.rule, finding.url);
        }
    }
    if (urls.size === 0) {
        return [];
    }
    const width = Math.max(...[...urls.keys()].map(rule => rule.length));
    return ['Rule documentation', ...[...urls].map(([rule, url]) => `  ${rule.padEnd(width)}  ${url}`)];
}
