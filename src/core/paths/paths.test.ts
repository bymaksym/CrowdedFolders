import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type IgnoreFile, isIgnored, parseGitignore } from './gitignore.ts';
import { compileGlob, globProblem, matchesSelfOrAncestor, PathMatcher } from './glob.ts';
import { FileListError, isAbsolutePath, normaliseFileList } from './input.ts';
import { type Mirror, mirrorOf, parseMirror, sourceOf } from './mirrors.ts';
import { closest, editDistance } from './suggest.ts';
import { buildTree, joinPath, normalisePath, parentOf } from './tree.ts';

describe('compileGlob', () => {
    const matches = (pattern: string, path: string): boolean => compileGlob(pattern).test(path);

    it('reads a pattern without a slash at any depth, like .gitignore', () => {
        assert.equal(matches('node_modules', 'node_modules'), true);
        assert.equal(matches('node_modules', 'packages/a/node_modules'), true);
        assert.equal(matches('*.md', 'docs/guide/intro.md'), true);
    });

    it('anchors a pattern with a slash at the root', () => {
        assert.equal(matches('src/*.ts', 'src/a.ts'), true);
        assert.equal(matches('src/*.ts', 'lib/src/a.ts'), false);
        assert.equal(matches('src/*.ts', 'src/a/b.ts'), false);
        assert.equal(matches('./src/a.ts', 'src/a.ts'), true);
    });

    it('anchors a single name with a leading slash, like .gitignore', () => {
        assert.equal(matches('/data', 'data'), true);
        assert.equal(matches('/data', 'lib/data'), false);
        assert.equal(matches('./data', 'lib/data'), false);
        assert.equal(matches('data', 'lib/data'), true);
    });

    it('lets ** stand for no segment or many', () => {
        assert.equal(matches('src/**/test', 'src/test'), true);
        assert.equal(matches('src/**/test', 'src/a/b/test'), true);
        assert.equal(matches('src/**', 'src/a/b.ts'), true);
        assert.equal(matches('**/res/*', 'app/src/main/res/layout'), true);
    });

    it('reads ?, braces and classes', () => {
        assert.equal(matches('v?.md', 'v1.md'), true);
        assert.equal(matches('*.{ts,tsx}', 'a.tsx'), true);
        assert.equal(matches('*.{ts,tsx}', 'a.js'), false);
        assert.equal(matches('[ab].ts', 'b.ts'), true);
        assert.equal(matches('[!ab].ts', 'c.ts'), true);
        assert.equal(matches('[!ab].ts', 'a.ts'), false);
    });

    it('treats regular-expression characters as text', () => {
        assert.equal(matches('a+b(c).ts', 'a+b(c).ts'), true);
        assert.equal(matches('a.ts', 'abts'), false);
    });

    it('lets a final /** take the folder itself, as minimatch does (src/generated/** missed src/generated)', () => {
        assert.equal(matches('src/app/**', 'src/app'), true);
        assert.equal(matches('src/app/**', 'src/app/x/y.ts'), true);
        assert.equal(matches('src/app/**', 'src/apps'), false);
        assert.equal(matches('**/generated/**', 'lib/generated'), true);
        assert.equal(matches('**', 'anything/at/all'), true);
    });

    it('matches the root folder as "."', () => {
        assert.equal(matches('.', '.'), true);
    });
});

describe('matchesSelfOrAncestor', () => {
    it('matches a path inside an excluded folder', () => {
        const globs = [compileGlob('fixtures')];
        assert.equal(matchesSelfOrAncestor('fixtures/vite/dist/main.js', globs), true);
        assert.equal(matchesSelfOrAncestor('src/fixtures.ts', globs), false);
        assert.equal(matchesSelfOrAncestor('src/a.ts', []), false);
        assert.equal(matchesSelfOrAncestor('fixtures', globs), true);
    });
});

describe('PathMatcher', () => {
    it('answers as matchesSelfOrAncestor does, remembering folders and names (200 000 paths spent 60 % of the run in exclude)', () => {
        const patterns = [
            'node_modules',
            '**/locales',
            '*.png',
            '/vendor',
            'src/generated/**',
            '**/src/gen',
            '.*',
            '{a,b/c}',
        ];
        const globs = patterns.map(pattern => compileGlob(pattern));
        const matcher = new PathMatcher(globs);
        const paths = [
            'node_modules/x/index.js',
            'packages/a/node_modules/y.js',
            'app/locales/en.json',
            'app/locales.ts',
            'assets/logo.png',
            'assets/logo.png.ts',
            'vendor/a.go',
            'lib/vendor/a.go',
            'src/generated',
            'src/generated/x/y.ts',
            'lib/src/gen/a.ts',
            'src/gen/a.ts',
            '.github/workflows/ci.yml',
            'src/.env',
            'a',
            'b/c/d.ts',
            'x/b/c',
            'src/app/main.ts',
        ];
        for (const path of [...paths, ...paths]) {
            assert.equal(matcher.matchesSelfOrAncestor(path), matchesSelfOrAncestor(path, globs), path);
        }
        assert.equal(new PathMatcher([]).matchesSelfOrAncestor('a/b'), false);
        // A final "/" matches the folders above a file, not the file: ".*/" is .github/, not .eslintrc.
        const folders = [compileGlob('.*/')];
        const onlyFolders = new PathMatcher(folders);
        for (const [path, expected] of [
            ['.github/workflows/ci.yml', true],
            ['.eslintrc', false],
            ['src/.env', false],
            ['src/.cache/x', true],
        ] as const) {
            assert.equal(onlyFolders.matchesSelfOrAncestor(path), expected, path);
            assert.equal(matchesSelfOrAncestor(path, folders), expected, path);
        }
    });

    it('files a glob under the folders it spells out, or the name it starts with after **/', () => {
        assert.equal(compileGlob('packages/a/**').prefix, 'packages/a');
        assert.equal(compileGlob('apps/*/src').prefix, 'apps');
        assert.equal(compileGlob('/data').prefix, 'data');
        assert.equal(compileGlob('**/tests/**').prefix, '');
        assert.equal(compileGlob('**/tests/**').segment, 'tests');
        assert.equal(compileGlob('locales').name, 'locales');
        assert.equal(compileGlob('*.ts').segment, undefined);
    });

    it('names the plain segments after the first wildcard that every match holds', () => {
        assert.deepEqual(compileGlob('packages/*/src/x1/**').required, ['src', 'x1']);
        assert.deepEqual(compileGlob('**/tests/fixtures').required, ['tests', 'fixtures']);
        assert.deepEqual(compileGlob('packages/a/**').required, []);
        assert.deepEqual(compileGlob('apps/*.web/src').required, ['src']);
        // Inside braces or a class a "/" does not end a name the match must hold.
        assert.deepEqual(compileGlob('a/*/{b/mid/c,d}/e').required, ['e']);
        assert.deepEqual(compileGlob('a/*/{b,[}]/mid/c}/e').required, ['e']);
        for (const [glob, path] of [
            ['a/*/{b/mid/c,d}/e', 'a/x/d/e'],
            ['a/*/{b,[}]/mid/c}/e', 'a/x/b/e'],
        ] as const) {
            assert.equal(compileGlob(glob).test(path), true, glob);
        }
    });
});

describe('normaliseFileList', () => {
    it('reads ./ and \\ the way the command does (lint({ files }) made a folder "./src")', () => {
        const { files, problems } = normaliseFileList(['./src/a.ts', String.raw`src\b.ts`, 'src/a.ts', '', 'c.ts']);
        assert.deepEqual(files, ['src/a.ts', 'src/b.ts', 'c.ts']);
        assert.deepEqual(problems, []);
    });

    it('refuses a path that climbs out, or an absolute one with no root to read it from', () => {
        const { files, problems } = normaliseFileList(['../outside/a.ts', '/src/a.ts', String.raw`C:\repo\a.ts`]);
        assert.deepEqual(files, []);
        assert.deepEqual(
            problems.map(problem => problem.path),
            ['../outside/a.ts', '/src/a.ts', String.raw`C:\repo\a.ts`],
        );
        assert.match(new FileListError(problems).message, /3 paths of the file list cannot be read/u);
    });

    it('makes an absolute path under the root relative to it (C:\\repo\\src\\a.ts made a folder C:/repo/src)', () => {
        const windows = normaliseFileList(
            [String.raw`c:\Repo\src\a.ts`, String.raw`D:\other\b.ts`],
            String.raw`C:\repo`,
        );
        assert.deepEqual(windows.files, ['src/a.ts']);
        assert.deepEqual(
            windows.problems.map(problem => problem.path),
            [String.raw`D:\other\b.ts`],
        );
        const posix = normaliseFileList(['/home/u/proj/src/a.ts', '/home/u/project/b.ts'], '/home/u/proj');
        assert.deepEqual(posix.files, ['src/a.ts']);
        assert.equal(posix.problems.length, 1, 'the same prefix of another folder is not inside the root');
        assert.deepEqual(normaliseFileList(['/Home/u/proj/a.ts'], '/home/u/proj').files, [], 'POSIX keeps case');
    });

    it('tells an absolute path on any system', () => {
        assert.equal(isAbsolutePath('/a'), true);
        assert.equal(isAbsolutePath(String.raw`\\server\share`), true);
        assert.equal(isAbsolutePath('C:/a'), true);
        assert.equal(isAbsolutePath('a:b'), false);
        assert.equal(isAbsolutePath('src/a.ts'), false);
    });
});

describe('closest', () => {
    it('suggests what is one swap, or a case, away; nothing for a wild guess', () => {
        assert.equal(closest('explian', ['check', 'explain', 'init']), 'explain');
        assert.equal(closest('SRC/LIB', ['src/lib', 'src/app']), 'src/lib');
        assert.equal(closest('src/libb', ['src/lib', 'src/app']), 'src/lib');
        assert.equal(closest('xyz', ['check', 'init']), undefined);
        assert.equal(editDistance('ab', 'ba'), 1);
        assert.equal(editDistance('', 'abc'), 3);
    });
});

describe('gitignore', () => {
    const ignores = (text: string, folder = '', above = ''): IgnoreFile[] => [
        { folder, above, rules: parseGitignore(text), ignoreCase: false },
    ];

    it('reads a name at any depth, a folder-only pattern, and anchored ones', () => {
        const rules = ignores('# comment\nbuild/\n/dist\n*.log\ndocs/*.tmp\n');
        assert.equal(isIgnored(rules, 'android/app/build', true), true);
        assert.equal(isIgnored(rules, 'android/app/build', false), false, 'build/ is a folder only');
        assert.equal(isIgnored(rules, 'dist', true), true);
        assert.equal(isIgnored(rules, 'lib/dist', true), false);
        assert.equal(isIgnored(rules, 'a/b/x.log', false), true);
        assert.equal(isIgnored(rules, 'docs/a.tmp', false), true);
        assert.equal(isIgnored(rules, 'other/docs/a.tmp', false), false);
    });

    it('lets the last match win, ! bring a file back, and \\ escape', () => {
        const rules = ignores('*.ts\n!keep.ts\n\\#hash\n\\!bang\ntrailing \n');
        assert.equal(isIgnored(rules, 'a.ts', false), true);
        assert.equal(isIgnored(rules, 'src/keep.ts', false), false);
        assert.equal(isIgnored(rules, '#hash', false), true);
        assert.equal(isIgnored(rules, '!bang', false), true);
        assert.equal(isIgnored(rules, 'trailing', false), true);
    });

    it('reads ** as any number of folders, and a final /** as what is inside', () => {
        const rules = ignores('**/gen\na/**/z\nout/**\n');
        assert.equal(isIgnored(rules, 'x/y/gen', true), true);
        assert.equal(isIgnored(rules, 'a/z', false), true);
        assert.equal(isIgnored(rules, 'a/b/c/z', false), true);
        assert.equal(isIgnored(rules, 'out/x', false), true);
        assert.equal(isIgnored(rules, 'out', true), false);
    });

    it('reads ?, classes and stars in a name, and a long name that fails is quick', () => {
        const rules = ignores('v?.md\n[ab].c\n[!x]y\n*a*b*c*d*e\n');
        assert.equal(isIgnored(rules, 'v1.md', false), true);
        assert.equal(isIgnored(rules, 'b.c', false), true);
        assert.equal(isIgnored(rules, 'zy', false), true);
        assert.equal(isIgnored(rules, 'xy', false), false);
        assert.equal(isIgnored(rules, `${'a'.repeat(5000)}bcd`, false), false);
    });

    it('reads a nested file from its folder, and one above the root from where the root is', () => {
        const nested = ignores('/build\n', 'android');
        assert.equal(isIgnored(nested, 'android/build', true), true);
        assert.equal(isIgnored(nested, 'build', true), false);
        const above = ignores('android/app/build\n', '', 'android');
        assert.equal(isIgnored(above, 'app/build', true), true);
        const caseless: IgnoreFile[] = [{ folder: '', above: '', rules: parseGitignore('Build/'), ignoreCase: true }];
        assert.equal(isIgnored(caseless, 'build', true), true);
    });
});

describe('globProblem', () => {
    it('explains a pattern that cannot be read', () => {
        assert.equal(globProblem('src/*.ts'), undefined);
        assert.match(globProblem('') ?? '', /empty/u);
        assert.match(globProblem('src/{a,b') ?? '', /open/u);
        assert.match(globProblem('a]') ?? '', /never opened/u);
        assert.match(globProblem(String.raw`src\a`) ?? '', /"\/"/u);
    });
});

describe('normalisePath', () => {
    it('writes every path the same way, and refuses one that leaves the root', () => {
        assert.equal(normalisePath(String.raw`.\src\a.ts`), 'src/a.ts');
        assert.equal(normalisePath('/src//a/../b.ts/'), 'src/b.ts');
        assert.equal(normalisePath('../a'), undefined);
        assert.equal(normalisePath('.'), undefined);
    });
});

describe('buildTree', () => {
    it('makes every folder above a file, sorted with the root first', () => {
        const tree = buildTree(['src/b/x.ts', 'src/a.ts', 'README.md']);
        assert.deepEqual(
            tree.map(folder => [folder.path, folder.depth, folder.files, folder.folders]),
            [
                ['.', 0, ['README.md'], ['src']],
                ['src', 1, ['a.ts'], ['b']],
                ['src/b', 2, ['x.ts'], []],
            ],
        );
        assert.equal(parentOf('a'), '.');
        assert.equal(joinPath('.', 'a'), 'a');
        assert.equal(joinPath('src', 'a'), 'src/a');
    });

    it('builds a tree ten thousand folders deep without overflowing the stack', () => {
        const deep = `${Array.from({ length: 10_000 }, () => 'd').join('/')}/x.ts`;
        const tree = buildTree([deep]);
        assert.equal(tree.length, 10_001);
        assert.equal(tree.at(-1)?.files[0], 'x.ts');
    });
});

describe('mirrors', () => {
    const read = (text: string): Mirror => {
        const mirror = parseMirror(text);
        assert.ok(typeof mirror !== 'string', mirror as string);
        return mirror;
    };
    const problem = (text: string): string => {
        const mirror = parseMirror(text);
        return typeof mirror === 'string' ? mirror : 'read';
    };

    it('maps a folder to its mirror and back, keeping the shared parts', () => {
        const maven = read('**/src/main/java/** => **/src/test/java/**');
        assert.equal(mirrorOf('api/src/main/java/com/a', maven), 'api/src/test/java/com/a');
        assert.equal(sourceOf('api/src/test/java/com/a', maven), 'api/src/main/java/com/a');
        assert.equal(mirrorOf('src/test/java/com/a', maven), undefined);
        const jest = read('** => **/__tests__');
        assert.equal(mirrorOf('src/cli', jest), 'src/cli/__tests__');
        assert.equal(mirrorOf('.', jest), '__tests__');
        assert.equal(sourceOf('src/cli/__tests__', jest), 'src/cli');
        const rails = read('app/** => spec/**');
        assert.equal(mirrorOf('app/models', rails), 'spec/models');
        assert.equal(mirrorOf('src/app/models', rails), undefined);
    });

    it('says what is wrong with one it cannot read', () => {
        assert.match(problem('src/main => '), /mirror: is empty/u);
        assert.match(problem('src/main/java'), /source => mirror/u);
        assert.match(problem('** => test/**'), /same parts/u);
        assert.match(problem('src/*/java/** => test/**'), /"\*" is not a folder name/u);
    });
});
