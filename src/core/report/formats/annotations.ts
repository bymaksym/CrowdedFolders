import { anchors, staleAnchor } from '../context/anchor.ts';
import { byWeight, describe, describeStale, failureMessage, STALE_SUPPRESSION_RULE } from '../describe.ts';
import type { Report, ReportFinding } from '../report.ts';
import { safe } from '../sanitize.ts';

export interface AnnotationOptions {
    /** How many annotations of each kind to write; the rest become one "and N more". */
    readonly maxPerKind?: number;
}

/** GitHub shows 10 annotations of each type per step and drops the rest without a word: 9 and a line saying so. */
export const DEFAULT_ANNOTATIONS = 9;

interface Annotation {
    readonly level: 'error' | 'warning';
    readonly rule: string;
    readonly text: string;
    readonly file: string | undefined;
    readonly line: number;
}

/**
 * One annotation per finding and stale suppression, worst first within each kind, at most
 * `maxPerKind` of each kind and then one that counts the rest.
 */
function annotationsOf(report: Report, options: AnnotationOptions): Annotation[] {
    const anchorOf = anchors(report);
    const all: Annotation[] = report.findings.toSorted(byWeight).map((finding: ReportFinding) => {
        const anchor = anchorOf(finding);
        return {
            level: finding.severity === 'error' ? 'error' : 'warning',
            rule: finding.rule,
            text: describe(report, finding),
            file: anchor.path,
            line: anchor.line,
        };
    });
    const stale: Annotation[] = report.staleSuppressions.map(entry => {
        const anchor = staleAnchor(report, entry);
        return {
            level: 'error',
            rule: STALE_SUPPRESSION_RULE,
            text: describeStale(entry),
            file: anchor.path,
            line: anchor.line,
        };
    });
    // A failed run has no findings; its reason is an error on the configuration, written first.
    const failure: Annotation[] = report.failure
        ? [
              {
                  level: 'error',
                  rule: 'config/error',
                  text: failureMessage(report, report.failure.message),
                  file: report.failure.file,
                  line: 1,
              },
          ]
        : [];

    const max = options.maxPerKind ?? DEFAULT_ANNOTATIONS;
    const result: Annotation[] = [...failure];
    for (const level of ['error', 'warning'] as const) {
        const ofLevel = [...all, ...stale].filter(annotation => annotation.level === level);
        // Stale suppressions fail the run, so within the errors they go after the worst findings.
        const shown = ofLevel.length > max ? ofLevel.slice(0, max) : ofLevel;
        result.push(...shown);
        if (ofLevel.length <= max) {
            continue;
        }
        const rest = ofLevel.length - max;
        result.push({
            level,
            rule: 'more',
            text: `and ${rest} more ${level === 'error' ? 'errors' : 'warnings'} not shown here (GitHub shows ${max + 1} annotations of each kind per step): use --format markdown or sarif for the full list.`,
            file: undefined,
            line: 1,
        });
    }
    return result;
}

/** GitHub Actions workflow commands: one annotation per finding, on the file it is anchored to. */
export function formatGithub(report: Report, options: AnnotationOptions = {}): string {
    const lines = annotationsOf(report, options).map(annotation => {
        const properties = [
            ...(annotation.file === undefined
                ? []
                : [`file=${escapeProperty(annotation.file)}`, `line=${annotation.line}`]),
            `title=${escapeProperty(`crowded-folders: ${annotation.rule === 'more' ? 'more' : annotation.rule}`)}`,
        ];
        return `::${annotation.level} ${properties.join(',')}::${escapeData(annotation.text)}`;
    });
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Azure Pipelines logging commands: `##vso[task.logissue]`, which the run shows as issues. */
export function formatAzure(report: Report): string {
    const lines = annotationsOf(report, { maxPerKind: Number.MAX_SAFE_INTEGER }).map(annotation => {
        const properties = [
            `type=${annotation.level}`,
            ...(annotation.file === undefined
                ? []
                : [`sourcepath=${escapeAzure(annotation.file)}`, `linenumber=${annotation.line}`]),
            `code=${escapeAzure(annotation.rule)}`,
        ];
        return `##vso[task.logissue ${properties.join(';')}]${escapeAzureData(annotation.text)}`;
    });
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function escapeData(text: string): string {
    return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
    return escapeData(safe(text)).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function escapeAzureData(text: string): string {
    return text.replaceAll('%', '%AZP25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeAzure(text: string): string {
    return escapeAzureData(safe(text)).replaceAll(']', '%5D').replaceAll(';', '%3B');
}
