import type { StaleSuppression } from '../../suppressions.ts';
import { digest } from '../describe.ts';
import type { Report, ReportFinding } from '../report.ts';

/** The file and line a finding is shown at, in the formats that need one (SARIF, annotations, Checkstyle). */
export interface Anchor {
    /** Relative to the root, `/`-separated, and always a file. */
    readonly path: string;
    readonly line: number;
}

export const DEFAULT_CONFIG_FILE = 'crowded-folders.config.json';
export const DEFAULT_SUPPRESSIONS_FILE = 'crowded-folders-suppressions.json';

/**
 * Where each finding of a report is anchored. A finding is about a folder and the formats want a
 * file, so the choice has to survive the folder changing: the first file in alphabetical order does
 * not (adding `a.ts` moves every alert of the folder, and the alert closes and opens again). Each
 * candidate gets a number from the finding's identity and the file's name, and the lowest wins
 * (rendezvous hashing): adding a file moves the anchor only when the new file wins, and removing one
 * only when it was the anchor. With a base (`addedFiles`), the files the change adds go first, so
 * the annotation lands where the pull request shows.
 */
export function anchors(report: Report): (finding: ReportFinding) => Anchor {
    const needed = new Set(
        report.findings
            .filter(finding => finding.files.length === 0 && !finding.rule.startsWith('config/'))
            .map(finding => finding.folder),
    );
    const direct = new Map<string, string[]>();
    const below = new Map<string, string[]>();
    if (needed.size > 0) {
        for (const file of report.files ?? []) {
            let slash = file.lastIndexOf('/');
            let isDirect = true;
            for (;;) {
                const folder = slash === -1 ? '.' : file.slice(0, slash);
                if (needed.has(folder)) {
                    const index = isDirect ? direct : below;
                    const list = index.get(folder);
                    if (list) list.push(file);
                    else index.set(folder, [file]);
                }
                if (slash <= 0) break;
                slash = file.lastIndexOf('/', slash - 1);
                isDirect = false;
            }
        }
    }

    return finding => {
        if (finding.rule.startsWith('config/')) {
            const line = report.overrideLines?.[finding.key ?? ''] ?? 1;
            return { path: report.configFile ?? DEFAULT_CONFIG_FILE, line };
        }
        const seed = `${finding.folder}\0${finding.rule}\0${finding.key ?? ''}`;
        const candidates =
            finding.files.length > 0 ? finding.files : (direct.get(finding.folder) ?? below.get(finding.folder) ?? []);
        const path = pick(seed, candidates, report.addedFiles);
        return { path: path ?? report.configFile ?? DEFAULT_CONFIG_FILE, line: 1 };
    };
}

/** A stale suppression is shown on its own line of the suppressions file. */
export function staleAnchor(report: Report, stale: StaleSuppression): Anchor {
    return {
        path: report.suppressionsFile ?? DEFAULT_SUPPRESSIONS_FILE,
        line: report.suppressionLines?.[`${stale.folder}\0${stale.id}`] ?? 1,
    };
}

function pick(seed: string, candidates: readonly string[], added: ReadonlySet<string> | undefined): string | undefined {
    const preferred = added ? candidates.filter(candidate => added.has(candidate)) : [];
    const pool = preferred.length > 0 ? preferred : candidates;
    let best: string | undefined;
    let bestScore = '';
    for (const candidate of pool) {
        const score = digest(`${seed}\0${candidate}`);
        if (best !== undefined && score >= bestScore) {
            continue;
        }
        best = candidate;
        bestScore = score;
    }
    return best;
}
