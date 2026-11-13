import type { Preset } from '../../config/types.ts';

/** The folders Angular's guide asks not to make ("no components/ or services/"), where a team made them anyway. */
const TYPE_FOLDERS = [
    'components',
    'services',
    'utils',
    'helpers',
    'models',
    'types',
    'interfaces',
    'enums',
    'constants',
    'pipes',
    'directives',
    'guards',
    'interceptors',
    'resolvers',
];

export const angular: Preset = {
    description:
        "Angular's own guide: folders by feature, a component's files together, and sub-folders as a folder grows. The current guide gives no number (\"consider splitting further\"), so a folder of src/ has recommended's measured 20; under features/ the 10 of the former guide stays, which asked for sub-folders from seven files: an opinion, there is no current source for it. Counts a component and its template, styles and spec once. The hint is about TypeScript, so a folder of SCSS partials or images does not get it, and a folder that is already by type (utils/, services/) is told to group by topic inside, not to make features. Scripts and tooling outside src/ keep recommended's limit and no hint, and their moves drop the prefix the new folder says (tooling/validate/i18n.mjs). A file named after its identifier repeats its folder's name on purpose, so redundant-prefix stays off under strict.",
    sources: [
        {
            title: 'Angular style guide: project structure, "As the number of files in a directory grows, consider splitting further into additional sub-directories"',
            url: 'https://angular.dev/style-guide',
        },
        {
            title: 'Former Angular style guide, 04-04 "Flat": sub-folders at seven or more files',
            url: 'https://raw.githubusercontent.com/angular/angular/17.3.x/aio/content/guide/styleguide.md',
        },
    ],
    detect: { files: ['angular.json'], dependencies: ['@angular/core'] },
    keeps: {
        'redundant-prefix':
            'a file is named after the TypeScript identifier it holds (profile/user-profile-avatar.ts holds UserProfileAvatar): shortening the file would rename the identifier',
    },
    config: {
        extends: ['recommended'],
        exclude: ['.angular', 'src/environments'],
        rules: {
            // Kept off under strict: profile/user-profile-avatar.ts holds UserProfileAvatar, the name
            // the guide asks for, so repeating the folder is the idiom, not a repetition.
            'redundant-prefix': 'off',
        },
        overrides: [
            {
                // Scripts and tooling next to the app are not the app: the guide is about src/.
                folders: ['**/src', '**/src/**'],
                reason: 'The style guide is about the application code, which Angular puts in src/: "All of your Angular UI code (TypeScript, HTML, and styles) should live inside a directory named src".',
                rules: {
                    'max-files': [
                        'error',
                        {
                            hint: 'Angular asks for folders by feature, not by type (no components/ or services/).',
                            hintFor: ['*.ts'],
                        },
                    ],
                    // "Match file names to the TypeScript identifier within": user-profile-avatar.ts holds
                    // UserProfileAvatar, so a move keeps the name. Only here: tooling/validate-i18n.mjs
                    // holds no identifier, and goes to tooling/validate/i18n.mjs.
                    'prefix-groups': ['error', { dropPrefix: false }],
                },
            },
            {
                folders: TYPE_FOLDERS.map(name => `**/src/**/${name}`),
                reason: 'A folder that is already by type cannot be told to become a feature: what helps is grouping by topic inside it.',
                rules: {
                    'max-files': [
                        'error',
                        { hint: 'This folder is already by type: group by topic inside, e.g. utils/filters/.' },
                    ],
                },
            },
            {
                folders: ['**/src/**/features', '**/src/**/features/**'],
                reason: 'The 10 of the former guide, which asked for sub-folders early ("Flat": seven or more files), kept where the guide\'s feature folders are.',
                rules: { 'max-files': ['error', { max: 10 }] },
            },
        ],
    },
};
