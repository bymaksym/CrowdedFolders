import { measureFolders } from '../../core/engine.ts';
import {
    type FolderSeries,
    formatHistoryJson,
    formatHistoryText,
    growingFolders,
    type HistorySample,
    sampleCommits,
    seriesOf,
} from '../../core/history.ts';
import { joinPath } from '../../core/paths/tree.ts';
import { filesAt, firstParentLog } from '../../node/git-base.ts';
import { type Args, UsageError } from '../args.ts';
import { type Io, wantsSymbols } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';

/** How many commits are measured when `--samples` is not given. */
const DEFAULT_SAMPLES = 12;
/** How many folders are listed without a folder: the ones that grew most. */
const TOP_FOLDERS = 10;

/**
 * `crowded-folders history [folder]`: the folder's modules at `--samples` commits along the first
 * parents of HEAD, read from each commit's file names (`git ls-tree`), with today's configuration.
 * Returns 0: it describes, it does not judge.
 */
export function history(args: Args, io: Io, session: Session): number {
    const log = firstParentLog(session.root);
    if (log === undefined || log.length === 0) {
        throw new UsageError(`history reads the commits of HEAD, and git has none for ${session.root}`);
    }
    const [folder] = args.paths.length > 0 ? foldersFromPaths(args.paths, session, io.cwd) : [];
    const only = folder === undefined ? session.only : [folder];
    const samples: HistorySample[] = [];
    for (const { commit, date } of sampleCommits(log, args.samples ?? DEFAULT_SAMPLES)) {
        const listed = filesAt(session.root, commit);
        if (listed === undefined) {
            continue;
        }
        // As the run's own files are: relative to the configuration's folder.
        const files = session.scope === '.' ? listed : listed.map(path => joinPath(session.scope, path));
        const stats = measureFolders({
            files,
            config: session.loaded.config,
            rules: session.loaded.rules,
            ...(only && { only }),
        });
        samples.push({ commit, date, folders: new Map(stats.map(stat => [stat.path, stat])) });
    }
    const series: FolderSeries[] =
        folder === undefined ? growingFolders(samples, TOP_FOLDERS) : [seriesOf(folder, samples)];
    io.write(
        args.format === 'json'
            ? formatHistoryJson(series, samples)
            : formatHistoryText(series, samples, { symbols: wantsSymbols(io) }),
    );
    if (args.format !== 'json' && session.configPath !== undefined) {
        io.error(
            'Every commit is read with the configuration of today, so a limit changed since then counts the same.\n',
        );
    }
    return 0;
}
