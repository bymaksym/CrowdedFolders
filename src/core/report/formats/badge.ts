import type { Report } from '../report.ts';
import { healthOf } from '../tree/folder-tree.ts';

/** The colours shields.io knows by name, from the share of folders within the max-files limit. */
function colourOf(percent: number): string {
    if (percent >= 95) return 'brightgreen';
    if (percent >= 90) return 'green';
    if (percent >= 80) return 'yellowgreen';
    if (percent >= 70) return 'yellow';
    return percent >= 50 ? 'orange' : 'red';
}

/**
 * The share of folders within their max-files limit as a shields.io endpoint (`https://img.shields.io/endpoint?url=`):
 * a JSON file the CI writes and the README's badge reads. A repository where no folder has a limit
 * (every rule off) gets a grey "n/a" rather than a green 100.
 */
export function formatBadge(report: Pick<Report, 'folderStats'>): string {
    const health = healthOf(report.folderStats ?? []);
    const badge =
        health === undefined
            ? { schemaVersion: 1, label: 'folders within limit', message: 'n/a', color: 'lightgrey' }
            : {
                  schemaVersion: 1,
                  label: 'folders within limit',
                  message: `${health.percent}%`,
                  color: colourOf(health.percent),
              };
    return `${JSON.stringify(badge)}\n`;
}
