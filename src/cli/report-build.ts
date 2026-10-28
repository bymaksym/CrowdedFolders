import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

import type { EngineResult, Finding } from '../core/engine.ts';
import { CONFIG_RULES } from '../core/report/describe.ts';
import { lineOfSequence, quoted } from '../core/report/locate.ts';
import { type Codeowners, ownersOf, parseCodeowners } from '../core/report/owners.ts';
import { projectFolders, projectOf } from '../core/report/projects.ts';
import type { Report, ReportFinding, RunInfo } from '../core/report/report.ts';
import type { StaleSuppression } from '../core/suppressions.ts';
import { readCodeowners } from '../node/codeowners.ts';
import { addedFiles } from '../node/git-diff.ts';
import { type Args, UsageError } from './args.ts';
import type { Io } from './io.ts';
import type { Session } from './session.ts';
import { TOOL } from './tool.ts';

/** Adds the project and the owners to each finding. */
export function enrichFindings(findings: readonly Finding[], session: Session, args: Args): ReportFinding[] {
    const projects = projectFolders(session.files);
    const text = readCodeowners(session.root);
    if (text === undefined && args.owners.length > 0) {
        throw new UsageError('--owner needs a CODEOWNERS file (.github/CODEOWNERS, CODEOWNERS or docs/CODEOWNERS)');
    }
    const codeowners: Codeowners = text === undefined ? [] : parseCodeowners(text);
    return findings.map(finding => ({
        ...finding,
        project: projectOf(finding.folder, projects),
        owners: ownersOfFinding(codeowners, finding),
    }));
}

/** The owners of the folder as a directory; failing that, of its first file. */
function ownersOfFinding(codeowners: Codeowners, finding: Finding): readonly string[] {
    if (codeowners.length === 0) {
        return [];
    }
    const ofFolder = finding.folder === '.' ? [] : ownersOf(codeowners, `${finding.folder}/`);
    const first = finding.files[0];
    return ofFolder.length > 0 || first === undefined ? ofFolder : ownersOf(codeowners, first);
}

export interface BuildInput {
    readonly args: Args;
    readonly io: Io;
    readonly session: Session;
    readonly result: EngineResult;
    readonly findings: readonly ReportFinding[];
    readonly suppressedCount: number;
    readonly stale: readonly StaleSuppression[];
    /** Absolute path of the suppressions file. */
    readonly suppressionsPath: string;
}

/** Everything the output formats need to know about a run. */
export function buildReport(input: BuildInput): Report {
    const { args, io, session, result } = input;
    const configFile = relativeToRoot(session.root, session.configPath);
    const suppressionsFile = relativeToRoot(session.root, input.suppressionsPath);

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
        ...suppressionLinesOf(input.stale, input.suppressionsPath),
        ...addedFilesOf(args, io, session),
        hide: hiddenFolders(session.root, io),
        ...(result.folderStats && { folderStats: result.folderStats }),
    };
}

/** The folders that must not appear in a report: the repository, where it ran, the home folder. */
export function hiddenFolders(root: string, io: Io): { dir: string; as: string }[] {
    const home = io.env['HOME'] ?? io.env['USERPROFILE'] ?? homedir();
    return [
        { dir: root, as: '' },
        { dir: io.cwd, as: '' },
        { dir: home, as: '~/' },
    ].toSorted((a, b) => b.dir.length - a.dir.length);
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
        configFile: relativeToRoot(session.root, session.configPath) ?? null,
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

/** The line of each stale suppression in the suppressions file. */
function suppressionLinesOf(
    stale: readonly StaleSuppression[],
    path: string,
): Partial<Pick<Report, 'suppressionLines'>> {
    if (stale.length === 0 || !existsSync(path)) {
        return {};
    }
    const text = readFileSync(path, 'utf8');
    const lines: Record<string, number> = {};
    for (const entry of stale) {
        const line = lineOfSequence(text, [
            ['"suppressions"'],
            [JSON.stringify(entry.folder)],
            [JSON.stringify(entry.id)],
        ]);
        if (line !== undefined) {
            lines[`${entry.folder}\0${entry.id}`] = line;
        }
    }
    return { suppressionLines: lines };
}

const ANCHORED_FORMATS = new Set<string>(['auto', 'azure', 'checkstyle', 'github', 'gitlab', 'sarif']);

/** The files this change adds, when `--base` (or a pull request's base branch) says what to compare with. */
function addedFilesOf(args: Args, io: Io, session: Session): Partial<Pick<Report, 'addedFiles'>> {
    if (args.outputs.every(spec => !ANCHORED_FORMATS.has(spec.format)) || session.fileSource !== 'git') {
        return {};
    }
    const pullRequestBase = io.env['GITHUB_BASE_REF'];
    const base = args.base ?? (pullRequestBase ? `origin/${pullRequestBase}` : undefined);
    const added = base === undefined ? undefined : addedFiles(session.root, base);
    return added === undefined ? {} : { addedFiles: added };
}
