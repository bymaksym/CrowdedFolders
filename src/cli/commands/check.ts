import { isAbsolute, relative, resolve } from 'node:path';

import { changeBetween, compareWithBase, foldersOf, type TreeChange } from '../../core/changes.ts';
import { type Finding, runEngine, selectFiles } from '../../core/engine.ts';
import { normalisePath } from '../../core/paths/tree.ts';
import { formatGithub, formatJson, formatMarkdown, formatSarif } from '../../core/report/machine.ts';
import { exitCodeOf, isOverMaxWarnings, type Report, totalsOf } from '../../core/report/report.ts';
import { formatText } from '../../core/report/text.ts';
import {
    addSuppressions,
    applySuppressions,
    DEFAULT_SUPPRESSIONS,
    pruneSuppressions,
    type Suppression,
    type SuppressionContext,
} from '../../core/suppressions.ts';
import { type Base, ciBaseOf, readBase } from '../../node/git-base.ts';
import { type Args, UsageError } from '../args.ts';
import { type Io, wantsColor, writeFileAtomic } from '../io.ts';
import { foldersFromPaths, type Session } from '../session.ts';
import { SuppressionStore } from '../suppressions-store.ts';
import { TOOL } from '../tool.ts';

/** The default command: checks the repository and prints the report. Returns the exit code. */
export function check(args: Args, io: Io, session: Session): number {
    refuseWritesInCi(args, io);
    const config = session.loaded.config;
    const store = new SuppressionStore(
        session.root,
        args.suppressionsLocation ?? config.suppressions ?? DEFAULT_SUPPRESSIONS,
        session.files,
    );
    // What the tool writes itself is not part of the repository's shape: after --suppress-all the
    // count of files must not go up by one.
    const own = new Set(store.ownFiles());
    const output = args.output === undefined ? undefined : insideRoot(session.root, resolve(io.cwd, args.output));
    if (output !== undefined) {
        own.add(output);
    }
    const files = own.size === 0 ? session.files : session.files.filter(path => !own.has(path));

    const since = changedSince(args, io, session, own, files);
    const newSince = args.newSince === undefined ? undefined : baseOrThrow(session, args.newSince, '--new-since', own);
    if (newSince) {
        noteBase('--new-since', newSince, io);
    }

    const only = args.paths.length > 0 ? foldersFromPaths(args.paths, session, io.cwd) : undefined;
    const result = runEngine({ files, config, rules: session.loaded.rules, ...(only && { only }) });

    let inScope: ((folder: string) => boolean) | undefined;
    if (only) {
        inScope = folder => only.some(path => path === '.' || folder === path || folder.startsWith(`${path}/`));
    } else if (since) {
        const touched = since.change.touched;
        inScope = folder => touched.has(folder);
    }
    const findings = since
        ? result.findings.filter(finding => finding.rule.startsWith('config/') || inScope?.(finding.folder) === true)
        : result.findings;

    let suppressions: readonly Suppression[] = store.read();
    if (args.suppressAll || args.suppressRules.length > 0) {
        const unknown = args.suppressRules.filter(rule => session.loaded.rules[rule] === undefined);
        if (unknown.length > 0) {
            throw new UsageError(`--suppress-rule: ${unknown.join(', ')} is not a rule`);
        }
        const edit = addSuppressions(suppressions, findings, {
            ...(!args.suppressAll && { rules: args.suppressRules }),
            fileFor: store.fileFor,
        });
        store.write(edit, io, 'add');
        suppressions = edit.suppressions;
    }
    if (args.pruneSuppressions) {
        const edit = pruneSuppressions(suppressions, findings, { ...(inScope && { inScope }) });
        store.write(edit, io, 'prune');
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

    let kept: readonly Finding[] = outcome.kept;
    let knownOnBase: Report['knownOnBase'];
    if (newSince) {
        const base = runEngine({ files: newSince.files, config, rules: session.loaded.rules });
        const compared = compareWithBase(kept, base.findings, {
            label: newSince.label,
            ...(change && { renamed: change.renamed }),
        });
        kept = compared.kept;
        knownOnBase = { label: newSince.label, count: compared.known.length };
    }
    const hiddenWarnings = args.quiet ? kept.filter(finding => finding.severity === 'warn').length : 0;

    const report: Report = {
        tool: TOOL,
        findings: args.quiet ? kept.filter(finding => finding.severity === 'error') : kept,
        suppressedCount: outcome.suppressed.length,
        staleSuppressions: args.passOnUnprunedSuppressions ? [] : outcome.stale,
        folderCount: result.folderCount,
        fileCount: result.fileCount,
        rules: Object.entries(config.rules)
            .filter(([, state]) => state.severity !== 'off')
            .map(([id]) => ({
                id,
                description: session.loaded.rules[id]?.meta.description ?? '',
                url: session.loaded.rules[id]?.meta.url,
            })),
        hiddenWarnings,
        ...(args.maxWarnings !== undefined && { maxWarnings: args.maxWarnings }),
        ...(knownOnBase && { knownOnBase }),
    };

    const isColor = args.output === undefined && wantsColor(args.color, io);
    const rendered = render(report, args, isColor);
    if (args.output === undefined) {
        io.write(rendered);
    } else {
        writeFileAtomic(resolve(io.cwd, args.output), rendered);
    }
    const summaryShown = args.format === 'text' && args.output === undefined;
    if (session.detected && summaryShown) {
        const presets = session.detected.map(detection => `${detection.preset} (${detection.evidence})`).join(', ');
        io.error(
            `No configuration file: used the presets detected — ${presets}. \`crowded-folders init\` writes them down.\n`,
        );
    }
    if (isOverMaxWarnings(report) && !summaryShown) {
        const warnings = totalsOf(report.findings).warnings + hiddenWarnings;
        io.error(`${warnings} warnings, over --max-warnings ${args.maxWarnings ?? 0}.\n`);
    }
    return exitCodeOf(report);
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

export function isCi(env: Io['env']): boolean {
    const value = env['CI']?.trim().toLowerCase();
    return value !== undefined && value !== '' && value !== '0' && value !== 'false';
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
        const candidates = ciBaseOf(io.env);
        if (candidates.length === 0) {
            io.error(
                '--changed: no pull-request base in the environment (GITHUB_BASE_REF, CI_MERGE_REQUEST_TARGET_BRANCH_NAME, …), so everything is checked. Pass --since <ref> to name one.\n',
            );
            return undefined;
        }
        const tried: string[] = [];
        for (const candidate of candidates) {
            for (const ref of candidate.refs) {
                const found = readBase(session.root, ref);
                if (!('problem' in found)) {
                    base = withoutOwn(found, own);
                    break;
                }
                tried.push(`${ref} (${candidate.variable})`);
            }
            if (base) {
                break;
            }
        }
        if (!base) {
            throw new UsageError(
                `--changed: git knows none of ${tried.join(', ')}. Fetch the base first (git fetch --depth=1 origin <branch>:refs/remotes/origin/<branch>), or check out with fetch-depth: 0`,
            );
        }
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

function baseOrThrow(session: Session, ref: string, flag: string, own: ReadonlySet<string>): Base {
    const found = readBase(session.root, ref);
    if ('problem' in found) {
        throw new UsageError(`${flag} ${ref}: ${found.problem}`);
    }
    return withoutOwn(found, own);
}

function withoutOwn(base: Base, own: ReadonlySet<string>): Base {
    return own.size === 0 ? base : { ...base, files: base.files.filter(path => !own.has(path)) };
}

function noteBase(flag: string, base: Base, io: Io): void {
    if (base.withoutMergeBase) {
        io.error(
            `${flag} ${base.label}: git found no merge base with HEAD (a shallow clone?), so this compares with the tip of ${base.label}. With fetch-depth: 0 it compares with where the branch started.\n`,
        );
    }
}

/** A path relative to the root when it is inside it, else `undefined`. */
function insideRoot(root: string, absolute: string): string | undefined {
    const path = relative(root, absolute);
    return path.startsWith('..') || isAbsolute(path) ? undefined : normalisePath(path);
}

function render(report: Report, args: Args, color: boolean): string {
    switch (args.format) {
        case 'json': {
            return formatJson(report);
        }
        case 'sarif': {
            return formatSarif(report);
        }
        case 'github': {
            return formatGithub(report);
        }
        case 'markdown': {
            return formatMarkdown(report);
        }
        default: {
            return formatText(report, { color, moves: args.moves });
        }
    }
}
