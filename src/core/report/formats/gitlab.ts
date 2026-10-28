import { anchors, staleAnchor } from '../context/anchor.ts';
import { describe, describeStale, fingerprintOf, STALE_SUPPRESSION_RULE, staleFingerprint } from '../describe.ts';
import type { Report } from '../report.ts';

/**
 * GitLab Code Quality (the `artifacts:reports:codequality` JSON): the merge-request widget shows
 * what a branch adds. Fingerprints are the same stable ones SARIF uses, made unique in the file
 * because GitLab drops a repeated one.
 */
export function formatGitlab(report: Report): string {
    const anchorOf = anchors(report);
    const seen = new Set<string>();
    const unique = (fingerprint: string): string => {
        let candidate = fingerprint;
        for (let n = 2; seen.has(candidate); n++) {
            candidate = `${fingerprint}-${n}`;
        }
        seen.add(candidate);
        return candidate;
    };
    const entries: Record<string, unknown>[] = report.findings.map(finding => {
        const anchor = anchorOf(finding);
        return {
            description: describe(report, finding),
            check_name: finding.rule,
            fingerprint: unique(fingerprintOf(finding)),
            severity: finding.severity === 'error' ? 'major' : 'minor',
            location: { path: anchor.path, lines: { begin: anchor.line } },
        };
    });
    for (const stale of report.staleSuppressions) {
        const anchor = staleAnchor(report, stale);
        entries.push({
            description: describeStale(stale),
            check_name: STALE_SUPPRESSION_RULE,
            fingerprint: unique(staleFingerprint(stale)),
            severity: 'major',
            location: { path: anchor.path, lines: { begin: anchor.line } },
        });
    }
    return `${JSON.stringify(entries, undefined, 2)}\n`;
}
