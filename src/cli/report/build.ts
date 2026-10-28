import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

import type { EngineResult, Finding } from '../../core/engine.ts';
import { lineOfSequence, quoted } from '../../core/report/context/locate.ts';
import { type Codeowners, ownersOf, parseCodeowners } from '../../core/report/context/owners.ts';
import { projectFolders, projectOf } from '../../core/report/context/projects.ts';
import { CONFIG_RULES } from '../../core/report/describe.ts';
import { referencesKey } from '../../core/report/formats/moves.ts';
import type { Report, ReportFinding, RunInfo } from '../../core/report/report.ts';
import { relativeTo, type StaleSuppression } from '../../core/suppressions.ts';
import { readCodeowners } from '../../node/codeowners.ts';
import { gitRootOf } from '../../node/config-file.ts';
import { filesNaming } from '../../node/references.ts';
import { type Args, type Format, UsageError } from '../args.ts';
import type { Io } from '../io.ts';
import type { Session } from '../session.ts';
import { TOOL } from '../tool.ts';

/** Adds the project and the owners to each finding. */
export function enrichFindings(findings: readonly Finding[], session: Session, args: Args): ReportFinding[] {
    const projects = projectFolders(session.files);
    const codeowners = codeownersOf(session);
    if (codeowners === undefined && args.owners.length > 0) {
        throw new UsageError('--owner needs a CODEOWNERS file (.github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS)');
    }
    return findings.map(finding => ({
        ...finding,
        project: projectOf(finding.folder, projects),
        owners: codeowners === undefined ? [] : ownersOfFinding(codeowners.rules, finding, codeowners.prefix),
    }));
}

/**
 * The CODEOWNERS of the folder the report's paths start at, else of the top of the git repository:
 * its patterns start where it is, so a report whose paths start lower needs a prefix to match them.
 */
function codeownersOf(session: Session): { readonly rules: Codeowners; readonly prefix: string } | undefined {
    const own = readCodeowners(session.base);
    if (own !== undefined) {
        return { rules: parseCodeowners(own), prefix: '' };
    }
    const top = gitRootOf(session.base);
    const text = top === undefined ? undefined : readCodeowners(top);
    if (top === undefined || text === undefined) {
        return undefined;
    }
    const from = relativeToRoot(top, session.base);
    return { rules: parseCodeowners(text), prefix: from === undefined || from === '' ? '' : `${from}/` };
}

/** The owners of the folder as a directory; failing that, of its first file. */
function ownersOfFinding(codeowners: Codeowners, finding: Finding, prefix: string): readonly string[] {
    if (codeowners.length === 0) {
        return [];
    }
    const folder = finding.folder === '.' ? prefix.slice(0, -1) : `${prefix}${finding.folder}`;
    const ofFolder = folder === '' ? [] : ownersOf(codeowners, `${folder}/`);
    const first = finding.files[0];
    return ofFolder.length > 0 || first === undefined ? ofFolder : ownersOf(codeowners, `${prefix}${first}`);
}

export interface BuildInput {
    readonly args: Args;
    readonly io: Io;
    readonly session: Session;
    readonly result: EngineResult;
    readonly findings: readonly ReportFinding[];
    readonly suppressedCount: number;
    readonly stale: readonly StaleSuppression[];
    /** Absolute path of the suppressions file (with `"per-project"`, the root's). */
    readonly suppressionsPath: string;
    /** Where the suppressions file a `StaleSuppression.file` names is, and the folder its keys start at. */
    readonly suppressionFile: (label: string) => { readonly absolute: string; readonly base: string } | undefined;
    /** Warnings `--quiet` left out of `findings`. */
    readonly hiddenWarnings: number;
    /** With `--new-since`: the base, and how many problems it already had. */
    readonly knownOnBase?: Report['knownOnBase'];
    /** The files this change adds, when a base is known: annotations go on them first. */
    readonly addedFiles?: ReadonlySet<string>;
}

/** Everything the output formats need to know about a run. */
export function buildReport(input: BuildInput): Report {
    const { args, io, session, result } = input;
    const configFile = relativeToRoot(session.base, session.configPath);
    const suppressionsFile = relativeToRoot(session.base, input.suppressionsPath);

    return {
        tool: TOOL,
        findings: input.findings,
        suppressedCount: input.suppressedCount,
        staleSuppressions: input.stale,
        folderCount: result.folderCount,
        fileCount: result.fileCount,
        rules: [
            ...Object.entries(session.loaded.rules).map(([id, rule]) => ({
                id,
                description: rule.meta.description,
                url: rule.meta.url,
            })),
            ...CONFIG_RULES,
        ],
        run: runInfo(session, io),
        files: session.files,
        ...(configFile !== undefined && { configFile }),
        ...(suppressionsFile !== undefined && { suppressionsFile }),
        ...overrideLinesOf(input.findings, session),
        ...suppressionLinesOf(input.stale, input.suppressionFile),
        ...(input.addedFiles && { addedFiles: input.addedFiles }),
        hide: hiddenFolders([session.root, session.base], io),
        ...(result.folderStats && { folderStats: result.folderStats }),
        hiddenWarnings: input.hiddenWarnings,
        ...(args.maxWarnings !== undefined && { maxWarnings: args.maxWarnings }),
        ...(input.knownOnBase && { knownOnBase: input.knownOnBase }),
        ...((args.moves || args.movesScript !== undefined) && {
            references: referencesOf(input.findings, session),
        }),
    };
}

/**
 * For each finding that moves files, the files that name what it moves (`--moves`): read here, in
 * the command, because the core never reads a file's contents.
 */
function referencesOf(findings: readonly Finding[], session: Session): Record<string, readonly string[]> {
    const groups = new Map(
        findings
            .filter(finding => finding.moves.length > 0)
            .map(finding => [referencesKey(finding), finding.moves.map(move => move.from)] as const),
    );
    return Object.fromEntries(filesNaming(session.base, session.files, groups));
}

/** The folders that must not appear in a report: the repository, where it ran, the home folder. */
export function hiddenFolders(roots: readonly string[], io: Io): { dir: string; as: string }[] {
    const home = io.env['HOME'] ?? io.env['USERPROFILE'] ?? homedir();
    return [...roots.map(dir => ({ dir, as: '' })), { dir: io.cwd, as: '' }, { dir: home, as: '~/' }].toSorted(
        (a, b) => b.dir.length - a.dir.length,
    );
}

function runInfo(session: Session, io: Io): RunInfo {
    const fromLayers = session.loaded.config.layers
        .map(layer => /^preset "(.+)"$/u.exec(layer)?.[1])
        .filter((name): name is string => name !== undefined);
    const presets = session.detected ? session.detected.map(detection => detection.preset) : fromLayers;
    const source = session.fileSource;
    const root = relative(io.cwd, session.root).split(sep).join('/');
    return {
        presets,
        presetsDetected: session.detected !== undefined,
        configFile: relativeToRoot(session.base, session.configPath) ?? null,
        fileSource:
            source.includes('stdin') || source.includes('standard input') ? 'stdin' : source === 'git' ? 'git' : 'disk',
        root: root === '' || isAbsolute(root) ? '.' : root,
    };
}

/** A path inside the root as the reports write it: relative, with `/`; `undefined` outside it. */
function relativeToRoot(root: string, path: string | undefined): string | undefined {
    if (path === undefined) {
        return undefined;
    }
    const relativePath = relative(root, path).split(sep).join('/');
    return relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath) ? undefined : relativePath;
}

/** The line of each unused override in the configuration file, found in its text. */
function overrideLinesOf(findings: readonly Finding[], session: Session): Partial<Pick<Report, 'overrideLines'>> {
    const unused = findings.filter(finding => finding.rule === 'config/unused-override');
    if (unused.length === 0 || session.configPath === undefined || !existsSync(session.configPath)) {
        return {};
    }
    const text = readFileSync(session.configPath, 'utf8');
    const lines: Record<string, number> = {};
    for (const finding of unused) {
        const override = session.loaded.config.overrides.find(candidate => candidate.folders.join(',') === finding.key);
        const glob = override?.folders[0] ?? finding.key;
        if (glob === undefined || finding.key === undefined) {
            continue;
        }
        const line =
            lineOfSequence(text, [['"overrides"', 'overrides'], quoted(glob)]) ?? lineOfSequence(text, [quoted(glob)]);
        if (line !== undefined) {
            lines[finding.key] = line;
        }
    }
    return { overrideLines: lines };
}

/** The line of each stale suppression in the file that holds it. */
function suppressionLinesOf(
    stale: readonly StaleSuppression[],
    fileOf: BuildInput['suppressionFile'],
): Partial<Pick<Report, 'suppressionLines'>> {
    if (stale.length === 0) {
        return {};
    }
    const texts = new Map<string, string | undefined>();
    const lines: Record<string, number> = {};
    for (const entry of stale) {
        const file = fileOf(entry.file);
        if (file === undefined) {
            continue;
        }
        if (!texts.has(file.absolute)) {
            texts.set(file.absolute, existsSync(file.absolute) ? readFileSync(file.absolute, 'utf8') : undefined);
        }
        const text = texts.get(file.absolute);
        if (text === undefined) {
            continue;
        }
        // The file writes the folder from its own base: a project's, with "per-project".
        const line = lineOfSequence(text, [
            ['"suppressions"'],
            [JSON.stringify(relativeTo(file.base, entry.folder))],
            [JSON.stringify(entry.id)],
        ]);
        if (line !== undefined) {
            lines[`${entry.folder}\0${entry.id}`] = line;
        }
    }
    return { suppressionLines: lines };
}

const ANCHORED_FORMATS = new Set<Format>(['auto', 'azure', 'checkstyle', 'github', 'gitlab', 'sarif']);

/** Whether a report asked for puts findings on files, so that the files a change adds are worth knowing. */
export function wantsAnchors(args: Args, session: Session): boolean {
    return session.fileSource === 'git' && args.outputs.some(spec => ANCHORED_FORMATS.has(spec.format));
}
