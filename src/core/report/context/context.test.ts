import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hidePaths, safe } from '../sanitize.ts';
import { lineOfSequence, quoted } from './locate.ts';
import { ownersOf, parseCodeowners } from './owners.ts';
import { projectFolders, projectOf } from './projects.ts';

describe('projects', () => {
    const files = [
        'package.json',
        'apps/web/package.json',
        'apps/web/src/app/a.ts',
        'services/billing/go.mod',
        'services/billing/internal/db/db.go',
        'tools/x.sh',
        'libs/core/BUILD.bazel',
        'crates/net/Cargo.toml',
        'java/pom.xml',
        'nx/app/project.json',
    ];

    it('finds the folders that hold a manifest', () => {
        assert.deepEqual(
            [...projectFolders(files)].toSorted((a, b) => a.localeCompare(b)),
            ['.', 'apps/web', 'crates/net', 'java', 'libs/core', 'nx/app', 'services/billing'],
        );
    });

    it('gives the nearest project, from the folder upwards', () => {
        const projects = projectFolders(files);
        assert.equal(projectOf('apps/web/src/app', projects), 'apps/web');
        assert.equal(projectOf('services/billing/internal/db', projects), 'services/billing');
        assert.equal(projectOf('tools', projects), '.');
        assert.equal(projectOf('apps/web', projects), 'apps/web');
        assert.equal(projectOf('tools', projectFolders(['apps/web/package.json'])), null);
    });
});

describe('CODEOWNERS', () => {
    const codeowners = parseCodeowners(
        [
            '# who owns what',
            '*                       @org/everyone',
            '/docs/                  @org/writers   # trailing comment',
            '/docs/internal          ',
            '*.sql                   @org/data user@example.com',
            'apps/web/               @org/web',
            '/apps/web/src/legacy/   @org/legacy',
            '/scripts/*              @org/ops',
            '[Section]',
            'packages/**/api         @org/api',
            '',
        ].join('\r\n'),
    );

    it('lets the last pattern that matches win', () => {
        assert.deepEqual(ownersOf(codeowners, 'README.md'), ['@org/everyone']);
        assert.deepEqual(ownersOf(codeowners, 'apps/web/src/main.ts'), ['@org/web']);
        assert.deepEqual(ownersOf(codeowners, 'apps/web/src/legacy/old.ts'), ['@org/legacy']);
        assert.deepEqual(ownersOf(codeowners, 'apps/web/src/legacy/'), ['@org/legacy']);
    });

    it('reads directories, comments, emails and a pattern with no owner', () => {
        assert.deepEqual(ownersOf(codeowners, 'docs/guide/a.md'), ['@org/writers']);
        assert.deepEqual(ownersOf(codeowners, 'docs/internal/secret.md'), []);
        assert.deepEqual(ownersOf(codeowners, 'db/schema.sql'), ['@org/data', 'user@example.com']);
    });

    it('owns the files of `dir/*` but not the folders below', () => {
        assert.deepEqual(ownersOf(codeowners, 'scripts/build.sh'), ['@org/ops']);
        assert.deepEqual(ownersOf(codeowners, 'scripts/ci/build.sh'), ['@org/everyone']);
    });

    it('matches `**` in the middle', () => {
        assert.deepEqual(ownersOf(codeowners, 'packages/a/b/api/x.ts'), ['@org/api']);
    });

    it('a directory-only pattern does not own a file with that name', () => {
        assert.deepEqual(ownersOf(parseCodeowners('build/ @org/x'), 'src/build'), []);
        assert.deepEqual(ownersOf(parseCodeowners('build/ @org/x'), 'src/build/a.ts'), ['@org/x']);
    });
});

describe('locating a line', () => {
    const config = [
        '{',
        '  "extends": ["recommended"],',
        '  "overrides": [',
        '    { "folders": ["legacy/**"] }',
        '  ]',
        '}',
    ].join('\n');

    it('finds each text after the one before it', () => {
        assert.equal(lineOfSequence(config, [['"overrides"'], quoted('legacy/**')]), 4);
        assert.equal(lineOfSequence(config, [['"extends"']]), 2);
        assert.equal(lineOfSequence(config, [['"overrides"'], ['"extends"']]), undefined);
        assert.equal(lineOfSequence("export default { overrides: [{ folders: ['a/**'] }] }", [quoted('a/**')]), 1);
    });
});

describe('safe printing', () => {
    it('writes control characters and bidi overrides as escapes', () => {
        assert.equal(safe('a\tb\u{7F}c\u{85}d\u{202E}e'), 'a\\x09b\\x7fc\\x85d\\u202ee');
        assert.equal(safe('plain / ünïcode ✔'), 'plain / ünïcode ✔');
    });

    it('takes the machine folders out of a text, with either separator', () => {
        const hide = [
            { dir: 'C:\\Users\\ana\\repo', as: '' },
            { dir: '/home/ana', as: '~/' },
        ];
        assert.equal(
            hidePaths('in C:\\Users\\ana\\repo\\crowded-folders.config.json: x', hide),
            'in crowded-folders.config.json: x',
        );
        assert.equal(hidePaths('in C:/Users/ana/repo/a.json', hide), 'in a.json');
        assert.equal(hidePaths('see /home/ana/.config/x.json', hide), 'see ~/.config/x.json');
        assert.equal(hidePaths('at C:\\Users\\ana\\repo', hide), 'at .');
    });
});
