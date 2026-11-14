/**
 * The examples of docs/rules/*.md: a list of files, a configuration and the rule they show. The generated
 * test runs the command over each and writes what it printed into the page, so that a page cannot show
 * a message the command no longer prints.
 */
export interface DocsExample {
    /** The `<!-- output: id -->` block of the page that gets the output. */
    readonly id: string;
    /** The page, from the root of the repository. */
    readonly page: string;
    /** The configuration file the run reads. */
    readonly config: object;
    /** The files of the repository, as `git ls-files` prints them. */
    readonly files: readonly string[];
    /**
     * Whether the page also shows the fix (a `<!-- fix: id -->` block): the moves `--moves` prints, the
     * folder after them, and the run that comes back clean. Only for rules whose problem a move solves.
     */
    readonly fix?: boolean;
    /**
     * For a rule whose fix is a decision no move can make (how to split a folder, which of two names to
     * keep): the files after a person made it. The page shows them and the run on them, and the test
     * fails if the rule still fires there.
     */
    readonly fixed?: readonly string[];
}

/** The components of the examples by what they are about: how a person splits that folder. */
const BY_TOPIC: Readonly<Record<string, readonly string[]>> = {
    forms: ['checkbox', 'form', 'input', 'radio', 'select', 'slider', 'switch'],
    overlays: ['dialog', 'drawer', 'dropdown', 'menu', 'modal', 'popover', 'tooltip'],
    feedback: ['alert', 'badge', 'banner', 'chip', 'progress', 'skeleton', 'spinner'],
    navigation: ['breadcrumb', 'pagination', 'tabs'],
    display: ['accordion', 'avatar', 'button', 'calendar', 'card', 'carousel', 'divider', 'icon', 'list', 'table'],
};

const byTopic = (paths: (topic: string, name: string) => readonly string[]): string[] =>
    Object.entries(BY_TOPIC).flatMap(([topic, names]) => names.flatMap(name => paths(topic, name)));

const COMPONENTS = [
    'accordion',
    'alert',
    'avatar',
    'badge',
    'banner',
    'breadcrumb',
    'button',
    'calendar',
    'card',
    'carousel',
    'checkbox',
    'chip',
    'dialog',
    'divider',
    'drawer',
    'dropdown',
    'form',
    'icon',
    'input',
    'list',
    'menu',
    'modal',
    'pagination',
    'popover',
    'progress',
    'radio',
    'select',
    'skeleton',
    'slider',
    'spinner',
    'switch',
    'table',
    'tabs',
    'tooltip',
];

export const DOCS_EXAMPLES: readonly DocsExample[] = [
    {
        id: 'readme',
        page: 'README.md',
        config: { extends: ['recommended'] },
        files: [
            ...['json', 'markdown', 'pr', 'sarif', 'text'].map(name => `cli/render-${name}.ts`),
            'cli/main.ts',
            ...COMPONENTS.map(name => `src/components/${name}.tsx`),
        ],
    },
    {
        id: 'max-files',
        page: 'docs/rules/max-files.md',
        config: { extends: ['recommended'] },
        files: COMPONENTS.flatMap(name => [`src/components/${name}.tsx`, `src/components/${name}.spec.tsx`]),
        fixed: byTopic((topic, name) => [
            `src/components/${topic}/${name}.tsx`,
            `src/components/${topic}/${name}.spec.tsx`,
        ]),
    },
    {
        id: 'prefix-groups',
        fix: true,
        page: 'docs/rules/prefix-groups.md',
        config: { extends: ['recommended'] },
        files: [
            ...['json', 'markdown', 'pr', 'sarif', 'text'].map(name => `cli/render-${name}.ts`),
            'cli/main.ts',
            'cli/args.ts',
        ],
    },
    {
        id: 'redundant-prefix',
        fix: true,
        page: 'docs/rules/redundant-prefix.md',
        config: { extends: ['recommended'], rules: { 'redundant-prefix': 'error' } },
        files: ['render/render-json.ts', 'render/render-text.ts', 'render/render.ts'],
    },
    {
        id: 'max-folders',
        page: 'docs/rules/max-folders.md',
        config: { extends: ['strict'] },
        files: COMPONENTS.flatMap(name => [`src/features/${name}/index.ts`, `src/features/${name}/${name}.ts`]),
        fixed: byTopic((topic, name) => [
            `src/features/${topic}/${name}/index.ts`,
            `src/features/${topic}/${name}/${name}.ts`,
        ]),
    },
    {
        id: 'single-file-folders',
        page: 'docs/rules/single-file-folders.md',
        config: { extends: ['recommended'], rules: { 'single-file-folders': 'warn' } },
        files: ['src/utils/date/format.ts', 'src/utils/array.ts', 'src/utils/string.ts'],
        fixed: ['src/utils/date-format.ts', 'src/utils/array.ts', 'src/utils/string.ts'],
    },
    {
        id: 'case-collision',
        page: 'docs/rules/case-collision.md',
        config: { extends: ['recommended'], rules: { 'case-collision': 'error' } },
        files: ['src/Components/Button.ts', 'src/components/Card.ts', 'src/Foo.ts', 'src/foo.ts'],
        fixed: ['src/components/Button.ts', 'src/components/Card.ts', 'src/Foo.ts', 'src/foo-helpers.ts'],
    },
    {
        id: 'scattered-feature',
        fix: true,
        page: 'docs/rules/scattered-feature.md',
        config: { extends: ['recommended', 'java'], rules: { 'scattered-feature': 'error' } },
        files: [
            'controller/RegistroHorarioController.java',
            'dto/RegistroHorarioDto.java',
            'dto/RegistroUsuarioConRol.java',
            'model/RegistroHorario.java',
            'repository/RegistroHorarioRepository.java',
            'service/RegistroHorarioService.java',
        ].map(file => `src/main/java/com/laboral/time/${file}`),
    },
    {
        id: 'orphan-companions',
        page: 'docs/rules/orphan-companions.md',
        config: { extends: ['recommended', 'unity'] },
        files: ['Assets/Scripts/Player.cs.meta', 'Assets/Scripts/Enemy.cs', 'Assets/Scripts/Enemy.cs.meta'],
        fixed: [
            'Assets/Scripts/Player.cs',
            'Assets/Scripts/Player.cs.meta',
            'Assets/Scripts/Enemy.cs',
            'Assets/Scripts/Enemy.cs.meta',
        ],
    },
    {
        id: 'type-folders',
        page: 'docs/rules/type-folders.md',
        config: { extends: ['recommended', 'unreal'] },
        files: ['MF_HitFlashDemo', 'MI_RageBar', 'M_3DFont'].map(
            name => `Content/ActionRoguelike/Materials/${name}.uasset`,
        ),
        fixed: ['Effects/HitFlash/MF_HitFlashDemo', 'UI/RageBar/MI_RageBar', 'UI/Fonts/M_3DFont'].map(
            name => `Content/ActionRoguelike/${name}.uasset`,
        ),
    },
];
