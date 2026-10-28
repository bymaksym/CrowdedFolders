import type { Preset } from '../config/types.ts';

/**
 * Images, sound, video, fonts and the formats of animation, 3D and mobile assets (Rive, Lottie, glTF, FBX, KTX2). A folder of 300 icons is a set, not a drawer: crowding is about
 * code and documents. The game presets put them back, because there the assets are the project.
 */
export const MEDIA =
    '*.{png,jpg,jpeg,gif,svg,webp,avif,ico,icns,bmp,tif,tiff,psd,xcf,exr,hdr,mp3,wav,ogg,flac,m4a,aac,mp4,webm,mov,avi,mkv,ttf,otf,woff,woff2,eot,pdf,riv,lottie,caf,aiff,heic,glb,gltf,fbx,obj,tga,ktx2}';

/**
 * Folders of test data: fixtures, snapshots, golden and expected outputs. Their shape is the thing
 * under test, so they are not arranged, and a manifest inside one says nothing about the repository.
 */
export const TEST_DATA: readonly string[] = [
    '*[fF]ixtures',
    '__fixtures__',
    '__snapshots__',
    '[sS]napshots',
    '[sS]creenshots',
    '[gG]oldens',
    '[eE]xpected',
    '[tT]est[dD]ata',
    '__mocks__',
];

/**
 * Migrations are a numbered series, flat and in order in every tool that writes them, wherever the
 * project keeps them: Flyway has `locations`, TypeORM `src/migration`, golang-migrate any folder. The
 * shape of the name says it, so these are left out by name and not only by folder. Written as globs,
 * which compile to linear expressions.
 *
 * - Flyway: `V1__init.sql`, `V1_2__add_users.sql`, `U2__undo.sql`, repeatable `R__views.sql`.
 * - golang-migrate: `000001_create_users.up.sql` and its `.down.sql`.
 * - TypeORM, Sequelize, Knex, Phoenix, Prisma-style seeders: six or more digits (a timestamp), then
 *   `_` or `-`, then a title: `1612345678901-CreateUsers.ts`, `20240101120000_create_users.exs`.
 */
export const MIGRATION_SERIES: readonly string[] = [
    '{V,U}[0-9]*__*',
    'R__*',
    '*.{up,down}.sql',
    '[0-9][0-9][0-9][0-9][0-9][0-9]*[_-]*.{sql,ts,js,mjs,cjs,php,rb,py,cs,exs}',
];

/**
 * Generated code that is committed anyway, by the names its generators give it. `__generated__` is
 * Relay's and GraphQL Code Generator's, `*.generated.*` is what many tools append. A bare
 * `generated` or `gen` is a generated folder only at the root or directly in `src/`: further down it can
 * be a Java package.
 */
export const GENERATED: readonly string[] = [
    '__generated__',
    '*.generated.*',
    '/generated',
    '/gen',
    '**/src/generated',
    '**/src/gen',
];

/**
 * What every repository gets, whatever its language: the two rules that make the tool, at limits
 * measured on real repositories (see docs/presets.md), and the folders that are never yours to
 * arrange.
 */
export const recommended: Preset = {
    description:
        'The two rules that matter, at limits measured on real repositories: at most 20 modules in a folder (a module is a file with its companions: foo.ts, foo.spec.ts and foo.html are one), and 4 modules sharing a first word make a folder. Leaves out vendored, generated and test-data folders, changelog fragments, media, translations and the folders of tools (.github). Migrations are left out by their name as well as by their folder (Flyway V1__init.sql, golang-migrate 000001_x.up.sql), and so are fastlane/metadata and the usual names of generated code (__generated__, *.generated.*). The root of every package (a folder with package.json, go.mod, Cargo.toml…) gets the 40 of the repository root, scripts/ and tooling/ read validate-i18n as being about i18n, and __tests__ and stories follow the code they sit next to.',
    sources: [
        {
            title: 'Angular style guide: "consider splitting further"',
            url: 'https://angular.dev/style-guide#project-structure',
        },
        {
            title: 'Flyway: versioned migrations are named like V001.002__NewTwitterColumn.sql, repeatable ones R__SetDefaults.sql',
            url: 'https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations',
        },
        {
            title: 'golang-migrate: {version}_{title}.up.{extension} and {version}_{title}.down.{extension}',
            url: 'https://github.com/golang-migrate/migrate/blob/master/MIGRATIONS.md',
        },
        {
            title: 'fastlane deliver: "The folder has to be structured like this" (fastlane/metadata/en-US)',
            url: 'https://docs.fastlane.tools/actions/deliver/',
        },
        {
            title: 'Relay: "ahead-of-time compilation of GraphQL queries and fragments to generate artifacts" (kept in __generated__ folders)',
            url: 'https://relay.dev/docs/guides/compiler/',
        },
        {
            title: 'docs/presets.md: how the limits were measured',
            url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/presets.md',
        },
    ],
    config: {
        exclude: [
            // Someone else's code, kept byte for byte.
            'node_modules',
            // Anchored: a Java package can be called vendor (com/acme/vendor). Next to the manifest
            // that owns it, `init` and detection write it for each package of a monorepo.
            '/vendor',
            'third_party',
            'third-party',
            // Test data: its shape is the thing under test, or the tool that produced it. Either case:
            // PHP, Java, C# and Swift write Fixtures/, Snapshots/ and TestData/.
            ...TEST_DATA,
            // Changelog fragments: one file per merged change, collected and deleted at release
            // (rubocop's changelog/, towncrier's newsfragments/, scriv's changelog.d/).
            'changelog',
            'changelog.d',
            'changelog_unreleased',
            'newsfragments',
            // Folders whose name starts with a dot belong to the tool that reads them (.github,
            // .changeset, .vscode), and their layout is that tool's: GitHub, for one, only reads
            // workflows directly inside .github/workflows. It leaves out dot-files too (.eslintrc,
            // .env): to count them with max-files dotfiles, replace it with ".*/", the folders only.
            '.*',
            MEDIA,
            // Fastlane reads one folder per language and one file per field, and nothing deeper.
            '**/fastlane/metadata',
            // Migrations: flat and ordered by number or date in every tool that writes them, and
            // the remedy for too many is squashing, not folders. `migrate` alone is also a Go
            // command (cmd/migrate/main.go), so only Rails' db/migrate is left out by that name.
            'migrations',
            '**/db/migrate',
            '**/alembic/versions',
            '**/db/migration',
            ...MIGRATION_SERIES,
            // Generated, when it is committed anyway, or found by walking the disk without git.
            ...GENERATED,
            'dist',
            'coverage',
            '__pycache__',
            '.git',
        ],
        naming: {
            groupNumericPrefixes: false,
        },
        rules: {
            // 20 modules is about the median 95th percentile of folder sizes (19) measured over 36 repositories
            // of every ecosystem (docs/field-trial.md): it flags the biggest folder in twenty.
            'max-files': ['error', { max: 20, count: 'modules', dotfiles: false }],
            // Words that say nothing about what a file is about are not groups: test markers, and
            // the accessors and predicates of every language (GetAlbum, IsPlayed, HasSeries).
            'prefix-groups': [
                'error',
                { min: 4, words: 1, ignore: ['test', 'tests', 'spec', 'get', 'set', 'is', 'has', 'can', 'should'] },
            ],
            'max-folders': 'off',
            'redundant-prefix': 'off',
            'single-file-folders': 'off',
            // Off: a rule on by default would fail repositories that passed (a breaking change);
            // strict turns it on.
            'case-collision': 'off',
        },
        overrides: [
            {
                folders: [
                    '**/locales',
                    '**/locale',
                    '**/i18n',
                    '**/l10n',
                    '**/translations',
                    '**/lang',
                    '**/langs',
                    '**/[lL]ocali[sz]ation',
                    '**/[lL]ocali[sz]ation/**',
                ],
                reason: 'Translations are one file per language, side by side by nature: en, en-GB and en-US are not a group to move.',
                rules: { 'max-files': 'off', 'prefix-groups': 'off' },
            },
            {
                folders: ['**/scripts', '**/scripts/**', '**/tooling', '**/tooling/**', '**/bin', '**/bin/**'],
                reason: 'Scripts are named after the verb they run and the thing they run it on (validate-i18n, check-links): the thing is what they are about, not the verb.',
                naming: { ignoreLeadingWords: ['validate', 'check', 'build', 'generate', 'export'] },
            },
            {
                folders: [
                    '**/__tests__',
                    '**/__tests__/**',
                    '**/__stories__',
                    '**/__stories__/**',
                    '**/stories',
                    '**/stories/**',
                ],
                reason: 'Tests and stories mirror the code they are next to: when the code is split into folders they follow it, so the group is reported once, in the code.',
                rules: { 'prefix-groups': 'off' },
            },
            {
                folders: ['.'],
                reason: 'The root holds what tools look for there on their own: manifests, lockfiles, licences, configs.',
                rules: { 'max-files': ['error', { max: 40 }] },
            },
            {
                folders: ['**'],
                withFiles: ['package.json', 'project.json', 'go.mod', 'Cargo.toml', 'BUILD.bazel'],
                reason: 'The root of a package holds what its tools look for, like the root of the repository: the same 25 config files pass in the root and would fail in apps/shop.',
                rules: { 'max-files': ['error', { max: 40 }] },
            },
        ],
    },
};

/** For a team that wants a tidier tree than the measured median, and to keep it that way. */
export const strict: Preset = {
    description:
        "Tighter than recommended: at most 12 modules in a folder, 3 modules sharing a prefix make a folder, at most 20 subfolders, no module repeating its folder's name, no folder holding a single file, and no two names that differ only in case. It tightens the presets it is combined with, wherever it is listed (go then strict and strict then go are the same), and leaves alone what a preset keeps: java and dotnet keep redundant-prefix off, go's main.go and Cargo's lib.rs stay allowed alone in a folder. An opinion, not a measurement: use it when you want the tree tidier than most.",
    sources: [
        {
            title: 'Angular style guide (former LIFT "Flat" rule: sub-folders at seven or more files)',
            url: 'https://github.com/kenny-chow-my/AngularStyleGuide',
        },
    ],
    tightens: true,
    config: {
        extends: ['recommended'],
        rules: {
            'max-files': ['error', { max: 12, count: 'modules' }],
            'prefix-groups': ['error', { min: 3 }],
            'max-folders': ['error', { max: 20 }],
            'redundant-prefix': 'error',
            'single-file-folders': 'warn',
            'case-collision': 'error',
        },
    },
};
