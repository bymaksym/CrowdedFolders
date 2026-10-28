import type { FolderStat } from './findings.ts';
import { plural } from './plural.ts';

/**
 * How folders grew, from the file names of a few commits along the branch: "src/cli went from 8 to 31
 * modules in six months". Names only, as everywhere: each commit is one `git ls-tree`, so twelve
 * samples of a large repository cost a second or two, and no checkout.
 */

/** One commit measured: its hash, its date and the numbers of the folders asked about. */
export interface HistorySample {
    readonly commit: string;
    /** ISO 8601, as git prints `%cI`. */
    readonly date: string;
    readonly folders: ReadonlyMap<string, FolderStat>;
}

/** One folder across the samples, oldest first; `null` where the folder did not exist yet (or any more). */
export interface FolderSeries {
    readonly folder: string;
    readonly points: readonly {
        readonly commit: string;
        readonly date: string;
        readonly modules: number | null;
        readonly files: number | null;
    }[];
    /** The `max-files` limit at the last sample where it is on; `null` when it is off. */
    readonly limit: number | null;
}

/**
 * `count` commits of a log (newest first, as `git log` prints it), evenly spaced and oldest first:
 * the oldest and the newest are always in. Fewer when the log is shorter.
 */
export function sampleCommits<T>(log: readonly T[], count: number): T[] {
    if (log.length <= count) {
        return [...log].toReversed();
    }
    const chosen: T[] = [];
    const last = log.length - 1;
    for (let index = 0; index < count; index++) {
        const at = last - Math.round((index * last) / (count - 1));
        const item = log[at];
        if (item !== undefined && chosen.at(-1) !== item) {
            chosen.push(item);
        }
    }
    return chosen;
}

export function seriesOf(folder: string, samples: readonly HistorySample[]): FolderSeries {
    let limit: number | null = null;
    const points = samples.map(sample => {
        const stat = sample.folders.get(folder);
        if (stat) {
            limit = stat.limit;
        }
        return {
            commit: sample.commit,
            date: sample.date,
            modules: stat?.modules ?? null,
            files: stat?.files ?? null,
        };
    });
    return { folder, points, limit };
}

/** How much a series grew: its last count minus its first where it exists (a new folder from where it appeared). */
export function growthOf(series: FolderSeries): number {
    const first = series.points.find(point => point.modules !== null)?.modules ?? 0;
    const last = series.points.at(-1)?.modules ?? 0;
    return last - first;
}

/** The folders that grew the most between the first sample and the last, the most first; ties by path. */
export function growingFolders(samples: readonly HistorySample[], top: number): FolderSeries[] {
    const last = samples.at(-1);
    if (!last) {
        return [];
    }
    return [...last.folders.keys()]
        .map(folder => seriesOf(folder, samples))
        .filter(series => growthOf(series) > 0)
        .toSorted((a, b) => growthOf(b) - growthOf(a) || (a.folder < b.folder ? -1 : 1))
        .slice(0, top);
}

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const ASCII_BARS = ['_', '.', '-', '=', '+', '*', '#', '@'];

/** A line of bars, one per value, scaled from 0 to the largest; a space where there is no value. */
export function sparkline(values: readonly (number | null)[], symbols = true): string {
    const bars = symbols ? BARS : ASCII_BARS;
    const top = Math.max(0, ...values.filter(value => value !== null));
    return values
        .map(value => {
            if (value === null) {
                return ' ';
            }
            const step = top === 0 ? 0 : Math.round((value / top) * (bars.length - 1));
            return bars[step] ?? ' ';
        })
        .join('');
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const DAY = 86_400_000;

/** A span of time as people say it: "three weeks", "six months", "two years". */
export function spanInWords(from: string, to: string): string {
    const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY));
    if (days < 1) return 'less than a day';
    const say = (count: number, unit: string): string => {
        const written = NUMBER_WORDS[count] ?? String(count);
        return `${written} ${unit}${count === 1 ? '' : 's'}`;
    };
    if (days < 14) return say(days, 'day');
    if (days < 60) return say(Math.round(days / 7), 'week');
    return days < 730 ? say(Math.round(days / 30.44), 'month') : say(Math.round(days / 365.25), 'year');
}

/** "went from 8 to 31 modules in six months", from where the folder first appears in the samples. */
export function describeSeries(series: FolderSeries): string {
    const present = series.points.filter(point => point.modules !== null);
    const first = present[0];
    const last = series.points.at(-1);
    if (!first || !last) {
        return `${series.folder} is in none of the commits sampled`;
    }
    if (last.modules === null) {
        return `${series.folder} is gone: it had ${plural(present.at(-1)?.modules ?? 0, 'module')} at ${short(present.at(-1)?.commit)}`;
    }
    const span = spanInWords(first.date, last.date);
    const appeared = first === series.points[0] ? '' : ' since it appeared';
    if (first.modules === last.modules) {
        return `${series.folder} stayed at ${plural(last.modules, 'module')}${appeared} (${span})`;
    }
    const verb = (first.modules ?? 0) < last.modules ? 'went from' : 'came down from';
    return `${series.folder} ${verb} ${first.modules ?? 0} to ${plural(last.modules, 'module')} in ${span}${appeared}`;
}

export interface HistoryTextOptions {
    /** `false`: ASCII instead of the bars and arrows (a pipe, `TERM=dumb`). Default: symbols. */
    readonly symbols?: boolean;
}

/** The text of `crowded-folders history`: a line per folder, and for one folder every sample. */
export function formatHistoryText(
    series: readonly FolderSeries[],
    samples: readonly HistorySample[],
    options: HistoryTextOptions = {},
): string {
    const symbols = options.symbols !== false;
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last) {
        return 'No commits to sample.\n';
    }
    const arrow = symbols ? '→' : '->';
    const lines = [
        `${plural(samples.length, 'commit')} sampled along the first parents, ${day(first.date)} (${short(first.commit)}) ${arrow} ${day(last.date)} (${short(last.commit)}).`,
        '',
    ];
    if (series.length === 0) {
        lines.push('No folder grew between them.');
        return `${lines.join('\n')}\n`;
    }
    const width = Math.max(...series.map(item => item.folder.length));
    for (const item of series) {
        const counts = item.points.map(point => point.modules);
        const limit = item.limit === null ? '' : `, limit ${item.limit}`;
        lines.push(
            `${item.folder.padEnd(width)}  ${sparkline(counts, symbols)}  ${describeSeries(item).slice(item.folder.length + 1)}${limit}`,
        );
    }
    if (series.length === 1) {
        const [only] = series;
        lines.push('');
        for (const point of only?.points ?? []) {
            const modules = point.modules === null ? '-' : String(point.modules);
            const files = point.files === null ? '' : `  ${plural(point.files, 'file')}`;
            lines.push(`  ${day(point.date)}  ${short(point.commit)}  ${modules.padStart(4)}${files}`);
        }
    }
    return `${lines.join('\n')}\n`;
}

/** The JSON of `crowded-folders history`: every sample of every folder shown. */
export function formatHistoryJson(series: readonly FolderSeries[], samples: readonly HistorySample[]): string {
    return `${JSON.stringify(
        {
            samples: samples.map(sample => ({ commit: sample.commit, date: sample.date })),
            folders: series.map(item => ({
                folder: item.folder,
                limit: item.limit,
                growth: growthOf(item),
                summary: describeSeries(item),
                series: item.points,
            })),
        },
        undefined,
        2,
    )}\n`;
}

function day(date: string): string {
    return date.slice(0, 10);
}

function short(commit: string | undefined): string {
    return commit === undefined ? '' : commit.slice(0, 7);
}
