import { changeAgainstBase, changeBetween, compareWithBase, foldersOf, type TreeChange } from '../../core/changes.ts';
import { type Finding, runEngine, selectFiles } from '../../core/engine.ts';
import { joinPath } from '../../core/paths/tree.ts';
import { plural } from '../../core/plural.ts';
import { exitCodeOf, isOverMaxWarnings, type Report, totalsOf } from '../../core/report/report.ts';
import {
    addSuppressions,
    applySuppressions,
    DEFAULT_SUPPRESSIONS,
    PER_PROJECT,
    pruneSuppressions,
    type Suppression,
    type SuppressionContext,
} from '../../core/suppressions.ts';
import { type Base, ciBaseOf, readBase } from '../../node/git-base.ts';
import { type Args, UsageError } from '../args.ts';
import type { Io } from '../io.ts';
import { addedByFolder, buildReport, enrichFindings, tinyFilesOf, wantsAnchors } from '../report/build.ts';
import { emit, resolveFormat } from '../report/emit.ts';
import { outputPathsOf } from '../report/output-paths.ts';
import {
    foldersFromPaths,
    isCi,
    noRuleIsOn,
    noticeIfOutside,
    type Session,
    suppressionsPathOf,
    within,
} from '../session.ts';
import { SuppressionStore } from '../suppressions-store.ts';
import { compareConfigAt } from './compare-config.ts';

/** The default command: checks the repository and prints the report. Returns the exit code. */
export async function check(args: Args, io: Io, session: Session): Promise<number> {
    refuseWritesInCi(args, io);
    // Before anything is written: a folder or a tracked file given as a report's file is refused first.
    const outputPaths = outputPathsOf(args, session);
    const config = session.loaded.config;
    const location = args.suppressionsLocation ?? config.suppressions;
    const suppressionsPath = suppressionsPathOf(args, session, DEFAULT_SUPPRESSIONS);
    const store = new SuppressionStore(
        session.base,
        location === PER_PROJECT ? PER_PROJECT : suppressionsPath,
        session.files,
    );
    // What the tool writes itself is not part of the repository's shape: after --suppress-all the
    // count of files must not go up by one, nor after a run that wrote its reports in the repository.
    const own = new Set(store.ownFiles());
    for (const path of outputPaths) {
        const inside = path === undefined ? undefined : within(session.base, path);
        if (inside !== undefined) {
            own.add(inside);
        }
    }
    const files = own.size === 0 ? session.files : session.files.filter(path => !own.has(path));

    const since = changedSince(args, io, session, own, files);
    const newSince = args.newSince === undefined ? undefined : baseOrThrow(session, args.newSince, '--new-since', own);
    if (newSince) {
        noteBase('--new-since', newSince, io);
    }

    const only = args.paths.length > 0 ? foldersFromPaths(args.paths, session, io.cwd) : session.only;
    const result = runEngine({
        files,
        config,
        rules: session.loaded.rules,
        ...(only && { only }),
        stats: wantsStats(args, io),
    });

    // The folders this run judges: those asked for (or the root's, when it sits inside the
    // configuration's folder), and of those, with --since, the ones the change reshaped.
    const inOnly = only && ((folder: string): boolean => only.some(path => isUnder(folder, path)));
    const touched = since?.change.touched;
    const inScope =
        inOnly && touched
            ? (folder: string): boolean => inOnly(folder) && touched.has(folder)
            : (inOnly ?? (touched && ((folder: string): boolean => touched.has(folder))));
    const findings = since
        ? result.findings.filter(finding => finding.rule.startsWith('config/') || inScope?.(finding.folder) === true)
        : result.findings;

    // With no rule on there are no findings, so every suppression would read as fixed and be pruned.
    const nothingChecked = noRuleIsOn(config);
    if (nothingChecked) {
        const flag = args.pruneSuppressions
            ? '--prune-suppressions'
            : args.suppressAll
              ? '--suppress-all'
              : args.suppressRules.length > 0
                ? '--suppress-rule'
                : undefined;
        if (flag !== undefined) {
            throw new UsageError(
                `${flag}: no rule is on in the configuration, so nothing is checked and the suppressions would be rewritten from nothing. Turn rules on first (missing "extends": ["recommended"]?).`,
            );
        }
    }
    let suppressions: readonly Suppression[] = nothingChecked ? [] : store.read();
    if (args.suppressAll || args.suppressRules.length > 0) {
        const unknown = args.suppressRules.filter(rule => session.loaded.rules[rule] === undefined);
        if (unknown.length > 0) {
            throw new UsageError(`--suppress-rule: ${unknown.join(', ')} is not a rule`);
        }
        const edit = addSuppressions(suppressions, findings, {
            ...(!args.suppressAll && { rules: args.suppressRules }),
            fileFor: store.fileFor,
        });
        for (const path of store.write(edit, io, 'add')) {
            noticeIfOutside(io, session, path);
        }
        suppressions = edit.suppressions;
    }
    if (args.pruneSuppressions) {
        const edit = pruneSuppressions(suppressions, findings, { ...(inScope && { inScope }) });
        for (const path of store.write(edit, io, 'prune')) {
            noticeIfOutside(io, session, path);
        }
        suppressions = edit.suppressions;
    }

    const change = since?.change ?? (newSince ? changeBetween(newSince.files, files) : undefined);
    let folders: Set<string> | undefined;
    const existing = (): Set<string> => (folders ??= foldersOf(selectFiles(files, config)));
    const context: SuppressionContext = {
        folderExists: folder => existing().has(folder),
        folders: existing,
        rules: new Set(Object.keys(session.loaded.rules)),
        ...(inScope && { inScope }),
        ...(change && { renamed: change.renamed }),
    };
    const outcome = applySuppressions(findings, suppressions, context);

    const configChange =
        args.compareConfig === undefined ? undefined : await compareConfigAt(args, session, files, only, findings);
    if (configChange) {
        io.error(`--compare-config: ${configChange.summary}
`);
    }

    // A Markdown report (a pull-request comment) says what is new, what grew and what improved, against
    // the base it is given: --new-since, --since, --base or the pull request's.
    const wantsChange = args.outputs.some(spec => spec.format === 'markdown');
    const anchored = wantsAnchors(args, session) || wantsChange ? anchorBase(args, io, session, own) : undefined;
    const changeBase = wantsChange ? (newSince ?? since?.base ?? anchored) : undefined;
    const baseFindings = new Map<Base, readonly Finding[]>();
    const findingsOf = (base: Base): readonly Finding[] => {
        let found = baseFindings.get(base);
        if (!found) {
            found = runEngine({ files: base.files, config, rules: session.loaded.rules }).findings;
            baseFindings.set(base, found);
        }
        return found;
    };

    let kept: readonly Finding[] = outcome.kept;
    let knownOnBase: Report['knownOnBase'];
    if (newSince) {
        const compared = compareWithBase(kept, findingsOf(newSince), {
            label: newSince.label,
            ...(change && { renamed: change.renamed }),
        });
        kept = compared.kept;
        knownOnBase = { label: newSince.label, count: compared.known.length };
    }
    let reported = enrichFindings(kept, session, args);
    if (args.owners.length > 0) {
        // --owner runs the check for one team: the exit code follows what is left.
        const wanted = new Set(args.owners.map(owner => owner.toLowerCase()));
        reported = reported.filter(finding => finding.owners?.some(owner => wanted.has(owner.toLowerCase())));
    }
    const hiddenWarnings = args.quiet ? reported.filter(finding => finding.severity === 'warn').length : 0;

    const annotationBase = wantsAnchors(args, session) ? (anchored ?? since?.base ?? newSince) : undefined;
    const treeChange =
        changeBase && change && (changeBase === since?.base || changeBase === newSince)
            ? change
            : changeBase && changeBetween(changeBase.files, files);
    const baseChange =
        changeBase &&
        changeAgainstBase(findings, findingsOf(changeBase), {
            label: changeBase.label,
            ...(treeChange && { renamed: treeChange.renamed }),
            ...(inScope && { inScope }),
        });
    const report = buildReport({
        args,
        io,
        session,
        result,
        findings: args.quiet ? reported.filter(finding => finding.severity === 'error') : reported,
        suppressedCount: outcome.suppressed.length,
        stale: args.passOnUnprunedSuppressions ? [] : outcome.stale,
        suppressionsPath,
        suppressionFile: store.locate,
        hiddenWarnings,
        closest: wantsClosest(args, io),
        ...(wantsSizes(args, io) && { tinyFiles: tinyFilesOf(reported, session, io) }),
        ...(knownOnBase && { knownOnBase }),
        ...(baseChange && { change: baseChange }),
        ...(configChange && { configChange }),
        ...(annotationBase && { addedFiles: addedSince(annotationBase, files) }),
        ...(annotationBase && {
            addedByFolder: addedByFolder({ findings: reported, baseFiles: annotationBase.files, files, session }),
        }),
    });

    // Each report goes to the file checked above, or to standard output.
    const outputs = args.outputs.map((spec, index) => ({ ...spec, target: outputPaths[index] }));
    const { textToStdout } = emit(report, { ...args, outputs }, io);
    for (const path of outputPaths) {
        if (path !== undefined) {
            noticeIfOutside(io, session, path);
        }
    }
    if (session.detected && textToStdout && !args.quiet) {
        const presets = session.detected.map(detection => `${detection.preset} (${detection.evidence})`).join(', ');
        io.error(
            `No configuration file: used the presets ${args.detect ? 'detected' : 'given (--no-detect)'} — ${presets}. \`crowded-folders init\` writes them down.\n`,
        );
    }
    if (isOverMaxWarnings(report) && !textToStdout) {
        const warnings = totalsOf(report.findings).warnings + hiddenWarnings;
        io.error(`${plural(warnings, 'warning')}, over --max-warnings ${args.maxWarnings ?? 0}.\n`);
    }
    return exitCodeOf(report);
}

/** The formats that show the folders (the tree, the map, the badge) or the health figure of the summary. */
const WITH_STATS = new Set(['text', 'tree', 'html', 'badge']);

/**
 * Whether the numbers of every folder are needed: for `--stats`, and for the formats that show the folders or
 * the share of them within their limit, the summary of the text included.
 */
function wantsStats(args: Args, io: Io): boolean {
    return args.stats || args.outputs.some(spec => WITH_STATS.has(resolveFormat(spec.format, io.env)));
}

/** Whether a report that shows a folder over its limit has somewhere to say that its files are tiny. */
function wantsSizes(args: Args, io: Io): boolean {
    return args.outputs.some(spec => ['text', 'tree', 'html'].includes(resolveFormat(spec.format, io.env)));
}

/**
 * Whether a clean run has somewhere to say how near the folders are to their limit: the text report on
 * a terminal. The numbers cost a second look at every folder, so nothing else asks for them.
 */
function wantsClosest(args: Args, io: Io): boolean {
    return (
        !args.quiet &&
        io.stdoutIsTTY &&
        args.outputs.some(spec => spec.target === undefined && resolveFormat(spec.format, io.env) === 'text')
    );
}

/**
 * `--suppress-all` and `--prune-suppressions` in CI write a file nobody commits: the run passes and
 * the pull request shows nothing. Refused there unless asked for with `--force`.
 */
function refuseWritesInCi(args: Args, io: Io): void {
    const adds = args.suppressAll || args.suppressRules.length > 0;
    if ((!adds && !args.pruneSuppressions) || args.force || !isCi(io.env)) {
        return;
    }
    const flag = args.suppressAll ? '--suppress-all' : adds ? '--suppress-rule' : '--prune-suppressions';
    throw new UsageError(
        `${flag} writes the suppressions file, and this run is in CI (CI=${io.env['CI'] ?? ''}): the run would pass and the pull request would show nothing. Run it on your machine and commit the file, or pass --force.`,
    );
}

interface Since {
    readonly base: Base;
    readonly change: TreeChange;
}

/** `--since <ref>`, or `--changed` with the ref the CI names; `undefined` when neither applies. */
function changedSince(
    args: Args,
    io: Io,
    session: Session,
    own: ReadonlySet<string>,
    files: readonly string[],
): Since | undefined {
    let base: Base | undefined;
    if (args.since !== undefined) {
        base = baseOrThrow(session, args.since, '--since', own);
    } else if (args.changed) {
        const found = ciBase(io, session, own);
        if (found.candidates === 0) {
            io.error(
                '--changed: no pull-request base in the environment (GITHUB_BASE_REF, CI_MERGE_REQUEST_TARGET_BRANCH_NAME, …), so everything is checked. Pass --since <ref> to name one.\n',
            );
            return undefined;
        }
        if (!found.base) {
            throw new UsageError(
                `--changed: git knows none of ${found.tried.join(', ')}. Fetch the base first (git fetch --depth=1 origin <branch>:refs/remotes/origin/<branch>), or check out with fetch-depth: 0`,
            );
        }
        base = found.base;
    }
    if (!base) {
        return undefined;
    }
    noteBase(args.changed ? '--changed' : '--since', base, io);
    const change = changeBetween(
        selectFiles(base.files, session.loaded.config),
        selectFiles(files, session.loaded.config),
    );
    io.error(
        `${args.changed ? '--changed' : '--since'} ${base.label}: ${change.touched.size} folder${change.touched.size === 1 ? '' : 's'} reshaped (${change.added} file${change.added === 1 ? '' : 's'} added, ${change.removed} removed); suppressions of other folders are left alone.\n`,
    );
    return { base, change };
}

/** The first base the CI names that git knows, and what was tried. */
function ciBase(
    io: Io,
    session: Session,
    own: ReadonlySet<string>,
): { readonly base: Base | undefined; readonly candidates: number; readonly tried: readonly string[] } {
    const candidates = ciBaseOf(io.env);
    const tried: string[] = [];
    for (const candidate of candidates) {
        for (const ref of candidate.refs) {
            const found = readBase(session.root, ref);
            if (!('problem' in found)) {
                return { base: asSessionFiles(found, session, own), candidates: candidates.length, tried };
            }
            tried.push(`${ref} (${candidate.variable})`);
        }
    }
    return { base: undefined, candidates: candidates.length, tried };
}

/**
 * The base annotations are anchored against: `--base`, else (when no --since or --new-since names
 * one) the pull request's, as `--changed` reads it. Only a nicer place for an annotation, so a base
 * git does not know is said and skipped, never an error.
 */
function anchorBase(args: Args, io: Io, session: Session, own: ReadonlySet<string>): Base | undefined {
    if (args.base !== undefined) {
        const found = readBase(session.root, args.base);
        if ('problem' in found) {
            io.error(`--base ${args.base}: ${found.problem}; the annotations go on any file of each folder.\n`);
            return undefined;
        }
        return asSessionFiles(found, session, own);
    }
    // --since and --new-since name their base: the caller uses it.
    const named = args.since !== undefined || args.changed || args.newSince !== undefined;
    return named ? undefined : ciBase(io, session, own).base;
}

/** The files of this run that the base did not have. */
function addedSince(base: Base, files: readonly string[]): Set<string> {
    const before = new Set(base.files);
    return new Set(files.filter(path => !before.has(path)));
}

function baseOrThrow(session: Session, ref: string, flag: string, own: ReadonlySet<string>): Base {
    const found = readBase(session.root, ref);
    if ('problem' in found) {
        throw new UsageError(`${flag} ${ref}: ${found.problem}`);
    }
    return asSessionFiles(found, session, own);
}

/**
 * The base as this run's files are: relative to the session's base (git lists them from the root),
 * without the files the tool writes itself.
 */
function asSessionFiles(found: Base, session: Session, own: ReadonlySet<string>): Base {
    const files = session.scope === '.' ? found.files : found.files.map(path => joinPath(session.scope, path));
    return { ...found, files: own.size === 0 ? files : files.filter(path => !own.has(path)) };
}

/** Whether `folder` is `path` or inside it. */
function isUnder(folder: string, path: string): boolean {
    return path === '.' || folder === path || folder.startsWith(`${path}/`);
}

function noteBase(flag: string, base: Base, io: Io): void {
    if (base.withoutMergeBase) {
        io.error(
            `${flag} ${base.label}: git found no merge base with HEAD (a shallow clone?), so this compares with the tip of ${base.label}. With fetch-depth: 0 it compares with where the branch started.\n`,
        );
    }
}
