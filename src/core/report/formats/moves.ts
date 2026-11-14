import type { Finding } from '../../engine.ts';
import { parentOf } from '../../paths/tree.ts';
import { listNames, type Move } from '../../rules/rule.ts';
import type { Report } from '../report.ts';
import { safe } from '../sanitize.ts';

/** The shells `--moves=<shell>` writes for. */
export type Shell = 'pwsh' | 'sh';

/** The moves of one finding, ready to run: the folders to make first, then the moves. */
export interface MoveGroup {
    readonly folder: string;
    readonly rule: string;
    readonly key: string | undefined;
    /** Folders the moves go into, to make before them: `git mv` does not. */
    readonly directories: readonly string[];
    readonly moves: readonly Move[];
    /** Tracked files that name one of the paths moved; absent when nobody looked. */
    readonly references?: readonly string[];
}

/** How a finding is found in `Report.references`. */
export function referencesKey(finding: Pick<Finding, 'folder' | 'key' | 'rule'>): string {
    return `${finding.folder}\0${finding.rule}\0${finding.key ?? ''}`;
}

/** The findings that propose moves, as groups to run one after another. */
export function moveGroups(report: Pick<Report, 'findings' | 'references'>): MoveGroup[] {
    return report.findings
        .filter(finding => finding.moves.length > 0)
        .map(finding => {
            const references = report.references?.[referencesKey(finding)];
            return {
                folder: finding.folder,
                rule: finding.rule,
                key: finding.key,
                directories: directoriesOf(finding.moves),
                moves: finding.moves,
                ...(references && { references }),
            };
        });
}

/** The new folders of some moves, in the order they are first needed: renames in place need none. */
function directoriesOf(moves: readonly Move[]): string[] {
    const directories: string[] = [];
    for (const move of moves) {
        const to = parentOf(move.to);
        if (to !== parentOf(move.from) && to !== '.' && !directories.includes(to)) {
            directories.push(to);
        }
    }
    return directories;
}

/**
 * Only the commands, for one shell: a comment naming each group, then its `mkdir` and its `git mv`
 * lines, with no colour — to read, or to run from the root. Nothing is ever run by the tool.
 */
export function formatMovesScript(report: Pick<Report, 'findings' | 'references'>, shell: Shell): string {
    const lines: string[] = [];
    for (const group of moveGroups(report)) {
        if (lines.length > 0) {
            lines.push('');
        }
        const references = group.references ? ` — ${referencesLine(group.references)}` : '';
        lines.push(`# ${safe(`${groupTitle(group)}${references}`)}`);
        if (hasControlCharacter(group)) {
            // Inside quotes a newline is still a newline and ESC still reaches the terminal: no quoting
            // makes such a name safe to paste, so the group is left to a person.
            lines.push(
                `# skipped: a name with control characters (a line break, ESC, BEL) cannot be written safely in a ${shell} script; move these files by hand`,
            );
        } else {
            lines.push(...commandsOf(group, shell));
        }
    }
    for (const item of unmovedOf(report, shell === 'sh' ? quoteSh : quotePwsh)) {
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(`# ${safe(`${item.folder === '.' ? 'the root' : item.folder}: ${item.rule} - ${item.reason}`)}`);
    }
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** The moves as JSON, one entry per group, and the findings no group answers: `--moves=json`. */
export function formatMovesJson(report: Pick<Report, 'findings' | 'references'>): string {
    return `${JSON.stringify({ version: 1, groups: moveGroups(report), unmoved: unmovedOf(report, quoteSh) }, undefined, 2)}\n`;
}

/** A finding the moves do not answer, and why: an empty script would read as "nothing to do". */
export interface Unmoved {
    readonly folder: string;
    readonly rule: string;
    readonly reason: string;
}

/**
 * The folders over `max-files` with no group to move out of them (none of the findings of the folder
 * proposes a move), with the command that shows the groups that come close, quoted with `quote`.
 */
function unmovedOf(report: Pick<Report, 'findings'>, quote: (path: string) => string): Unmoved[] {
    return report.findings
        .filter(
            finding =>
                finding.rule === 'max-files' &&
                finding.moves.length === 0 &&
                report.findings.every(other => other.folder !== finding.folder || other.moves.length === 0),
        )
        .map(finding => ({
            folder: finding.folder,
            rule: finding.rule,
            reason: `no group to move out of it; crowded-folders explain ${quote(finding.folder)} shows the groups that come close`,
        }));
}

/** Control characters: a line break, ESC, BEL. */
const CONTROL = /\p{Cc}/u;

/** Whether a path a group makes or moves holds a control character. */
function hasControlCharacter(group: Pick<MoveGroup, 'directories' | 'moves'>): boolean {
    return [...group.directories, ...group.moves.flatMap(move => [move.from, move.to])].some(path =>
        CONTROL.test(path),
    );
}

/**
 * What the text report prints under a finding with `--moves`: its commands, for sh, and the files
 * that name what it moves. A folder over `max-files` with nothing to move says so, rather than
 * leaving a blank that reads as "nothing to do".
 */
export function moveLines(report: Pick<Report, 'findings' | 'references'>, finding: Finding): string[] {
    if (finding.moves.length === 0) {
        const proposal = report.findings.some(other => other.folder === finding.folder && other.moves.length > 0);
        return finding.rule === 'max-files' && !proposal
            ? [
                  `no group to move out of it — \`crowded-folders explain ${finding.folder}\` shows the groups that come close`,
              ]
            : [];
    }
    const references = report.references?.[referencesKey(finding)];
    return [
        ...commandsOf({ directories: directoriesOf(finding.moves), moves: finding.moves }, 'sh'),
        ...(references ? [referencesLine(references)] : []),
    ];
}

/** The commands of one group: its folders made, then its moves. */
export function commandsOf(group: Pick<MoveGroup, 'directories' | 'moves'>, shell: Shell): string[] {
    const quote = shell === 'sh' ? quoteSh : quotePwsh;
    const made = group.directories.map(directory =>
        shell === 'sh'
            ? `mkdir -p ${quote(directory)}`
            : `New-Item -ItemType Directory -Force -Path ${quote(directory)} | Out-Null`,
    );
    return [...made, ...group.moves.map(move => `git mv ${quote(move.from)} ${quote(move.to)}`)];
}

/** What a group is, for the comment above its commands: `src: prefix-groups "render"`. */
function groupTitle(group: MoveGroup): string {
    return `${group.folder === '.' ? 'the root' : group.folder}: ${group.rule}${group.key === undefined ? '' : ` "${group.key}"`}`;
}

/** The line that says which files name the paths a group moves: they break when it is applied. */
export function referencesLine(references: readonly string[]): string {
    if (references.length === 0) {
        return 'no other tracked file names these paths';
    }
    return `${references.length} ${references.length === 1 ? 'file names' : 'files name'} these paths: ${listNames(references)}`;
}

/** A path that starts with "-" would be read as an option by mkdir and git: `./-x` is the same file. */
function notAnOption(path: string): string {
    return path.startsWith('-') ? `./${path}` : path;
}

/** For sh, bash and zsh: bare when nothing in it is special, else in single quotes. */
export function quoteSh(path: string): string {
    const safePath = notAnOption(path);
    return /^[\w./@+-]+$/u.test(safePath) ? safePath : `'${safePath.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * For PowerShell: in single quotes, where nothing expands, with each quote doubled — the typographic
 * ones too (‘ ’ ‚ ‛), which PowerShell also reads as quotes. cmd.exe reads neither: use PowerShell.
 */
export function quotePwsh(path: string): string {
    const safePath = notAnOption(path);
    return /^[\w./-]+$/u.test(safePath)
        ? safePath
        : `'${safePath.replaceAll(/['‘’‚‛]/gu, quote => `${quote}${quote}`)}'`;
}
