import type { Finding } from './engine.ts';
import { compareText } from './naming/modules.ts';
import { plural, shownOf } from './plural.ts';
import { commandsOf, type MoveGroup, moveGroups, referencesLine } from './report/formats/moves.ts';

export interface PromptGroup {
    /** The words the modules start with: `render`. */
    readonly key: string;
    /** The stems of its modules. */
    readonly modules: readonly string[];
}

export interface PromptInput {
    /** Relative to the root; `.` is the root. */
    readonly folder: string;
    readonly files: number;
    readonly subfolders: readonly string[];
    /** One entry per module: its stem and its files. */
    readonly modules: readonly { readonly stem: string; readonly files: readonly string[] }[];
    /** Groups `prefix-groups` asks to move. */
    readonly groups: readonly PromptGroup[];
    /** Groups of two modules or more that do not reach the minimum, the biggest first. */
    readonly nearGroups: readonly PromptGroup[];
    /** How many modules make a group. */
    readonly min: number;
    readonly findings: readonly Finding[];
    /** The tracked files that name the paths each finding moves, by `referencesKey`. */
    readonly references: Readonly<Record<string, readonly string[]>>;
}

const MODULES_SHOWN = 60;
const REFERENCES_SHOWN = 40;

/**
 * The reorganisation of one folder as a task to paste to an AI agent: what the tool reports, what is in the
 * folder, the groups and the nearly-groups, the moves it proposes (nothing is applied), the files that name the
 * paths to move, and what to do after - the imports and the tests. A folder with no problem says so instead.
 */
export function reorganisationPrompt(input: PromptInput): string {
    const place = input.folder === '.' ? 'the root of the repository' : `\`${input.folder}/\``;
    if (input.findings.length === 0) {
        return `# Nothing to reorganise in ${place}\n\ncrowded-folders reports no problem there: ${plural(input.files, 'file')}, ${plural(input.modules.length, 'module')}. Leave it as it is.\n`;
    }
    const out: string[] = [
        `# Reorganise ${place}`,
        '',
        `crowded-folders (\`npx crowded-folders ${input.folder}\`) reports ${place} as a folder that has become a drawer. Reorganise it so that it passes, without changing what the code does.`,
        '',
        '## What it reports',
        ...input.findings.map(finding => `- ${finding.severity} ${finding.rule}: ${finding.message}`),
        '',
        '## What is in it',
        `${plural(input.files, 'file')}, ${plural(input.modules.length, 'module')}, ${plural(input.subfolders.length, 'subfolder')}${input.subfolders.length > 0 ? ` (${input.subfolders.map(name => `\`${name}/\``).join(', ')})` : ''}.`,
        'A module is the files that share a name: `foo.ts`, `foo.spec.ts` and `foo.html` are one.',
        '',
        ...modulesLines(input),
    ];

    if (input.groups.length > 0 || input.nearGroups.length > 0) {
        out.push('', '## Groups');
        for (const group of input.groups) {
            out.push(
                `- \`${group.key}-*\` (${group.modules.length}): ${group.modules.join(', ')} - a folder nobody made`,
            );
        }
        if (input.nearGroups.length > 0) {
            out.push(
                `Near-groups (fewer than the ${input.min} that make one, but the closest candidates for a folder):`,
            );
            for (const group of input.nearGroups.slice(0, 8)) {
                out.push(`- \`${group.key}-*\` (${group.modules.length}): ${group.modules.join(', ')}`);
            }
        }
    }

    const groups = moveGroups({ findings: input.findings, references: input.references });
    out.push('', '## Proposed moves');
    if (groups.length === 0) {
        out.push(
            'The tool proposes no move: no group of names is big enough. Choose the groups yourself from the near-groups and the module list above, by what the files are about, and move them with `git mv`.',
        );
    } else {
        out.push(
            'Nothing has been applied. Review them, rename a folder if another name fits better, and run them from the root of the repository:',
            '',
            '```sh',
            ...groups.flatMap((group, index) => [
                ...(index > 0 ? [''] : []),
                `# ${titleOf(group)}`,
                ...commandsOf(group, 'sh'),
            ]),
            '```',
        );
    }

    const references = [...new Set(groups.flatMap(group => group.references ?? []))].toSorted(compareText);
    if (groups.length > 0) {
        out.push('', '## Files that name these paths');
        if (references.length === 0) {
            out.push(`${referencesLine([])}.`);
        } else {
            const shown = shownOf(references.length, REFERENCES_SHOWN);
            out.push(
                'They break when the files move: update the import or the path in each.',
                ...references.slice(0, shown).map(file => `- ${file}`),
                ...(shown < references.length ? [`- and ${references.length - shown} more`] : []),
            );
        }
    }

    out.push(
        '',
        '## Do this',
        '1. Decide the folders (use the proposal above where it fits) and move the files with `git mv`, so that the history follows them.',
        '2. Update every import, path, script and configuration that names a moved file (the list above is where the tool saw them; search for the rest).',
        '3. Run the type check and the tests, and fix what the move broke. Do not change behaviour.',
        `4. Run \`npx crowded-folders ${input.folder}\` and make sure the folder is clean. Do not raise a limit, add an override or a suppression to get there.`,
    );
    return `${out.join('\n')}\n`;
}

function modulesLines(input: PromptInput): string[] {
    const shown = shownOf(input.modules.length, MODULES_SHOWN);
    return [
        ...input.modules.slice(0, shown).map(module => `- ${module.stem}: ${module.files.join(', ')}`),
        ...(shown < input.modules.length ? [`- and ${input.modules.length - shown} more modules`] : []),
    ];
}

function titleOf(group: MoveGroup): string {
    return `${group.folder === '.' ? 'the root' : group.folder}: ${group.rule}${group.key === undefined ? '' : ` "${group.key}"`}`;
}
