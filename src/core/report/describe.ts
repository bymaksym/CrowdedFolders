import type { StaleSuppression } from '../suppressions.ts';
import type { Report, ReportFinding, ReportRule } from './report.ts';
import { hidePaths, safe } from './sanitize.ts';

/** The rule id a stale suppression is reported under, in the formats that have rule ids. */
export const STALE_SUPPRESSION_RULE = 'config/stale-suppression';
export const UNUSED_OVERRIDE_RULE = 'config/unused-override';
export const EXPIRED_OVERRIDE_RULE = 'config/expired-override';

/** The `config/*` rules the tool reports itself, so that every id in a report has a descriptor. */
export const CONFIG_RULES: readonly ReportRule[] = [
    {
        id: UNUSED_OVERRIDE_RULE,
        description:
            'An override in the configuration matches no folder: it does nothing, so either its globs are wrong or it is left over.',
        url: undefined,
    },
    {
        id: EXPIRED_OVERRIDE_RULE,
        description:
            'An override is past the date in its "expires": it still applies, and is due for review. Renew the date, or remove it.',
        url: undefined,
    },
    {
        id: STALE_SUPPRESSION_RULE,
        description:
            'A suppression nothing needs any more: the problem it lets stay is fixed or smaller. Prune it, so the suppressions file only ever shrinks.',
        url: undefined,
    },
];

/** How a folder is named in a sentence: the root has no name of its own. */
export function folderLabel(folder: string): string {
    return folder === '.' ? 'the root' : folder;
}

/** The text of a finding with the machine's folders taken out; still raw otherwise. */
export function plainMessage(report: Pick<Report, 'hide'>, finding: Pick<ReportFinding, 'message'>): string {
    return report.hide ? hidePaths(finding.message, report.hide) : finding.message;
}

/**
 * The one sentence every format uses for a finding: `folder: message`, safe to print. A finding of
 * the `config/*` rules is about the configuration, not a folder, and says so itself.
 */
export function describe(report: Pick<Report, 'addedByFolder' | 'hide'>, finding: ReportFinding): string {
    const message = safe(plainMessage(report, finding));
    return finding.rule.startsWith('config/')
        ? message
        : `${safe(folderLabel(finding.folder))}: ${message}${addedNote(report, finding)}`;
}

/** With a base known: what the change adds to a folder over its limit, as " This change adds 1 (14→15).". */
function addedNote(report: Pick<Report, 'addedByFolder'>, finding: ReportFinding): string {
    const counts = finding.rule === 'max-files' ? report.addedByFolder?.[finding.folder] : undefined;
    return counts === undefined || counts.after <= counts.before
        ? ''
        : ` This change adds ${counts.after - counts.before} (${counts.before}→${counts.after}).`;
}

/** Why a run failed, for a person: the machine's folders out and control characters escaped, line breaks kept. */
export function failureMessage(report: Pick<Report, 'hide'>, message: string): string {
    return (report.hide ? hidePaths(message, report.hide) : message)
        .split('\n')
        .map(line => safe(line))
        .join('\n');
}

/** Why a suppression must be pruned, in a few words: what its `status` says. */
export function staleReason(stale: StaleSuppression): string {
    switch (stale.status) {
        case 'unknown-rule': {
            return `"${stale.rule}" is not a rule`;
        }
        case 'missing-folder': {
            const hint = stale.didYouMean === undefined ? '' : `: did you mean ${stale.didYouMean}?`;
            return `the folder does not exist, or holds no checked file${hint}`;
        }
        case 'moved': {
            return `looks moved to ${stale.movedTo ?? '?'}: rename its key in ${stale.file} to keep it`;
        }
        case 'lowered': {
            return `now ${stale.measured ?? 0}`;
        }
        default: {
            return 'fixed';
        }
    }
}

/** The sentence for a suppression the run says must be pruned (or, lowered, saved). */
export function describeStale(stale: StaleSuppression): string {
    const what = `${safe(stale.folder)}: ${safe(stale.id)} is suppressed at ${stale.count}`;
    if (stale.status === 'lowered') {
        return `${what} and is now ${stale.measured ?? 0}: save it with --prune-suppressions and commit ${safe(stale.file)}.`;
    }
    const why = stale.status === 'fixed' ? ' and is fixed' : `; ${safe(staleReason(stale))}`;
    return `${what}${why}: run with --prune-suppressions.`;
}

/** How far over its limit a finding is, to put the worst first. */
function weightOf(finding: ReportFinding): number {
    const over = finding.limit !== undefined && finding.limit > 0 ? finding.measured / finding.limit : finding.measured;
    return (finding.severity === 'error' ? 1_000_000 : 0) + over;
}

/** Orders findings worst first: errors before warnings, then the furthest over the limit. */
export function byWeight(a: ReportFinding, b: ReportFinding): number {
    return weightOf(b) - weightOf(a) || (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);
}

/**
 * A 53-bit hash of a text as 14 hexadecimal digits (cyrb53). Not for secrets: only a short, stable
 * name that survives between runs, for the formats that track a problem by fingerprint.
 */
function hash(text: string, seed: number): string {
    let h1 = 0xde_ad_be_ef ^ seed;
    let h2 = 0x41_c6_ce_57 ^ seed;
    for (let index = 0; index < text.length; index++) {
        const code = text.codePointAt(index) ?? 0;
        h1 = Math.imul(h1 ^ code, 2_654_435_761);
        h2 = Math.imul(h2 ^ code, 1_597_334_677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
    return (0x1_00_00_00_00 * (h2 & 0x1f_ff_ff) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A stable name for a text: 28 hexadecimal digits. */
export function digest(text: string): string {
    return hash(text, 0) + hash(text, 0x9e_37_79_b9);
}

/**
 * What identifies a problem between runs: the folder, the rule and the key, never the files (they
 * come and go) or the message (its numbers change). The same in SARIF and GitLab, so that an alert
 * closes only when the problem is gone.
 */
export function fingerprintOf(finding: Pick<ReportFinding, 'folder' | 'key' | 'rule'>): string {
    return digest(`${finding.folder}\0${finding.rule}\0${finding.key ?? ''}`);
}

export function staleFingerprint(stale: Pick<StaleSuppression, 'folder' | 'id'>): string {
    return digest(`${stale.folder}\0${STALE_SUPPRESSION_RULE}\0${stale.id}`);
}

/**
 * The limit as the configuration writes it, and how the measure is compared with it. A rule reports
 * the largest number that is still fine (`max: 20` → 20, fails above), and `prefix-groups` the same
 * (`min: 4` → 3), so the JSON gives `min` with `>=` for it, the way the configuration reads.
 */
export function limitOf(finding: Pick<ReportFinding, 'limit' | 'rule'>): {
    limit: number | null;
    comparison: '>' | '>=' | null;
} {
    if (finding.limit === undefined) {
        return { limit: null, comparison: null };
    }
    return finding.rule === 'prefix-groups'
        ? { limit: finding.limit + 1, comparison: '>=' }
        : { limit: finding.limit, comparison: '>' };
}
