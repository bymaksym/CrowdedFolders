import { anchors, staleAnchor } from './anchor.ts';
import {
    CONFIG_RULES,
    describe,
    describeStale,
    failureMessage,
    fingerprintOf,
    STALE_SUPPRESSION_RULE,
    staleFingerprint,
} from './describe.ts';
import type { Report, ReportRule } from './report.ts';
import { WHEN_IT_FIRES } from './rule-help.ts';

interface Location {
    physicalLocation: {
        artifactLocation: { uri: string; uriBaseId: string };
        region: { startLine: number };
    };
}

/**
 * SARIF 2.1.0, for GitHub code scanning and other viewers.
 *
 * What GitHub needs beyond the schema: a `region.startLine` on every location (without one the alert
 * has no line and is closed and reopened by every run), a fingerprint of the problem (ours is the
 * folder, the rule and the key, so adding a file to the folder does not reopen it), and a descriptor
 * for every rule id, with `ruleIndex`, so that the alert has a title and a help page. A finding is
 * about a folder and SARIF wants a file: see `anchors` for how the file is chosen.
 */
export function formatSarif(report: Report): string {
    const rules = ruleDescriptors(report);
    const indexOf = new Map(rules.map((rule, index) => [rule.id, index] as const));
    const anchorOf = anchors(report);
    const resultFor = (
        ruleId: string,
        level: 'error' | 'warning',
        text: string,
        anchor: { path: string; line: number },
        fingerprint: string,
    ): Record<string, unknown> => ({
        ruleId,
        ruleIndex: indexOf.get(ruleId) ?? 0,
        level,
        message: { text },
        locations: [locationOf(anchor.path, anchor.line)],
        partialFingerprints: { primaryLocationLineHash: `${fingerprint}:1`, 'crowdedFolders/v1': fingerprint },
    });

    const results = report.findings.map(finding =>
        resultFor(
            finding.rule,
            finding.severity === 'error' ? 'error' : 'warning',
            describe(report, finding),
            anchorOf(finding),
            fingerprintOf(finding),
        ),
    );
    for (const stale of report.staleSuppressions) {
        results.push(
            resultFor(
                STALE_SUPPRESSION_RULE,
                'error',
                describeStale(stale),
                staleAnchor(report, stale),
                staleFingerprint(stale),
            ),
        );
    }

    const sarif = {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: report.tool.name,
                        version: report.tool.version,
                        informationUri: report.tool.url,
                        rules: rules.map(rule => descriptorOf(rule)),
                    },
                },
                invocations: [invocationOf(report)],
                results,
                ...(report.run && {
                    properties: { ...report.run, filesChecked: report.fileCount, foldersChecked: report.folderCount },
                }),
            },
        ],
    };
    return `${JSON.stringify(sarif, undefined, 2)}\n`;
}

/** Every rule that is loaded, then the `config/*` ones, then any id a finding names that is none of them. */
function ruleDescriptors(report: Report): ReportRule[] {
    const rules = new Map<string, ReportRule>();
    for (const rule of [...report.rules, ...CONFIG_RULES]) {
        if (!rules.has(rule.id)) {
            rules.set(rule.id, rule);
        }
    }
    for (const finding of report.findings) {
        if (!rules.has(finding.rule)) {
            rules.set(finding.rule, { id: finding.rule, description: finding.rule, url: finding.url });
        }
    }
    return [...rules.values()];
}

function descriptorOf(rule: ReportRule): Record<string, unknown> {
    const plain = plainText(rule.description);
    const when = WHEN_IT_FIRES[rule.id];
    const docs = rule.url ? `\n\nDocumentation: ${rule.url}` : '';
    return {
        id: rule.id,
        shortDescription: { text: plain },
        help: {
            text: `${plain}${when ? `\n\nWhen it fires: ${plainText(when)}` : ''}${docs}`,
            markdown: `${rule.description}${when ? `\n\n**When it fires.** ${when}` : ''}${rule.url ? `\n\n[Documentation](${rule.url})` : ''}`,
        },
        ...(rule.url && { helpUri: rule.url }),
    };
}

function invocationOf(report: Report): Record<string, unknown> {
    if (report.failure === undefined) {
        return { executionSuccessful: true };
    }
    return {
        executionSuccessful: false,
        toolExecutionNotifications: [
            {
                level: 'error',
                message: { text: failureMessage(report, report.failure.message) },
                ...(report.failure.file !== undefined && { locations: [locationOf(report.failure.file, 1)] }),
            },
        ],
    };
}

function locationOf(path: string, line: number): Location {
    return {
        physicalLocation: {
            artifactLocation: { uri: encodeUri(path), uriBaseId: '%SRCROOT%' },
            region: { startLine: line },
        },
    };
}

/** Markdown in a description is text in a place that shows text: no backticks around names. */
function plainText(text: string): string {
    return text.replaceAll('`', '');
}

function encodeUri(path: string): string {
    return path
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}
