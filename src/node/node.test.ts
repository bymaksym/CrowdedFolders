import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runEngine } from '../core/engine.ts';
import { findConfig, locate, readConfigFile } from './config-file.ts';
import { GitError, listFiles, parseFileList } from './files.ts';
import { ConfigError, loadConfig, loadConfigFile, pluginProblem } from './load-config.ts';
import { resolveSpecifier } from './modules.ts';

const EXAMPLE_PLUGIN = fileURLToPath(new URL('../../examples/plugin', import.meta.url));

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

function folder(files: Readonly<Record<string, string>> = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'crowded-folders-node-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

/** A folder with the example plugin installed in its node_modules, as a user would have it. */
function withPlugin(files: Readonly<Record<string, string>>): string {
    const root = folder(files);
    cpSync(EXAMPLE_PLUGIN, join(root, 'node_modules', 'crowded-folders-plugin-example'), { recursive: true });
    return root;
}

const rejects = async (promise: Promise<unknown>, pattern: RegExp): Promise<void> => {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof ConfigError, String(error));
        assert.match(error.message, pattern);
        return true;
    });
};

describe('plugins', () => {
    it('loads a plugin installed next to the configuration, its rules and its presets', async () => {
        const root = withPlugin({});
        const loaded = await loadConfig(
            { plugins: ['crowded-folders-plugin-example'], extends: ['example/recommended'] },
            'test.json',
            root,
        );
        assert.ok(loaded.rules['example/generic-names']);
        assert.equal(loaded.config.rules['example/generic-names']?.severity, 'warn');
        const result = runEngine({
            files: ['src/utils/a.ts', 'src/user/b.ts'],
            config: loaded.config,
            rules: loaded.rules,
        });
        assert.deepEqual(
            result.findings.map(finding => `${finding.rule} ${finding.folder}`),
            ['example/generic-names src/utils'],
        );
    });

    it('validates the options of a plugin rule against its schema', async () => {
        const root = withPlugin({});
        await rejects(
            loadConfig(
                {
                    plugins: ['crowded-folders-plugin-example'],
                    rules: { 'example/generic-names': ['error', { names: 'utils' }] },
                },
                'test.json',
                root,
            ),
            /rules\["example\/generic-names"\]\[1\]\.names: must be a list/u,
        );
    });

    it('explains a plugin that is missing, broken, or uses a namespace already taken', async () => {
        const root = folder({
            'broken.mjs': 'export default { rules: {} };',
            'twin.mjs': "export default { meta: { name: 'twin', namespace: 'example' } };",
        });
        await rejects(loadConfig({ plugins: ['crowded-folders-plugin-nope'] }, 'test.json', root), /is not installed/u);
        await rejects(
            loadConfig({ plugins: ['./broken.mjs'] }, 'test.json', root),
            /is not a crowded-folders plugin: its default export needs a "meta"/u,
        );
        await rejects(
            loadConfig({ plugins: [join(EXAMPLE_PLUGIN, 'index.js'), './twin.mjs'] }, 'test.json', root),
            /two plugins use the namespace "example"/u,
        );
        await rejects(
            loadConfig({ rules: { 'example/generic-names': 'error' } }, 'test.json', root),
            /no plugin in "plugins" defines it/u,
        );
    });

    it('checks the shape of what a plugin exports', () => {
        assert.equal(pluginProblem({ meta: { name: 'x', namespace: 'x' } }), undefined);
        assert.match(pluginProblem({ meta: { name: 'x', namespace: 'X Y' } }) ?? '', /namespace/u);
        assert.match(
            pluginProblem({ meta: { name: 'x', namespace: 'x' }, rules: { a: {} } }) ?? '',
            /rule "a" needs a "meta" object/u,
        );
        const meta = { description: 'd', defaultOptions: {} };
        assert.match(
            pluginProblem({ meta: { name: 'x', namespace: 'x' }, rules: { a: { meta } } }) ?? '',
            /rule "a" needs a "check" function \(or "create"/u,
        );
        assert.match(
            pluginProblem({ meta: { name: 'x', namespace: 'x' }, presets: { a: { config: {} } } }) ?? '',
            /needs "description"/u,
        );
    });
});

describe('extends', () => {
    it('applies files and packages in order, each once, and refuses a cycle', async () => {
        const root = folder({
            'base.json': '{ "extends": ["recommended"], "rules": { "max-files": ["error", { "max": 7 }] } }',
            'a.json': '{ "extends": ["./b.json"] }',
            'b.json': '{ "extends": ["./a.json"] }',
        });
        const loaded = await loadConfig({ extends: ['./base.json', 'recommended'] }, join(root, 'mine.json'), root);
        assert.equal(
            loaded.config.rules['max-files']?.options['max'],
            7,
            'recommended is not applied a second time over base.json',
        );
        await rejects(loadConfig({ extends: ['./a.json'] }, join(root, 'mine.json'), root), /extends itself/u);
        await rejects(
            loadConfig({ extends: ['recomended'] }, 'mine.json', root),
            /is not a preset \(known: recommended/u,
        );
    });

    it('reads a configuration written in JavaScript, as an object or a function', async () => {
        const root = folder({
            'crowded-folders.config.mjs': 'export default () => ({ extends: ["strict"] });',
            'other.mjs': 'export default { rules: { "max-files": "warn" } };',
        });
        assert.deepEqual(await readConfigFile(join(root, 'crowded-folders.config.mjs')), { extends: ['strict'] });
        const loaded = await loadConfigFile(join(root, 'other.mjs'));
        assert.equal(loaded.config.rules['max-files']?.severity, 'warn');
    });

    it('reads a configuration from a package.json key, and from .config/', async () => {
        const root = folder({
            'package.json': '{ "crowded-folders": { "extends": ["go"] } }',
            'sub/.config/crowded-folders.jsonc': '// x\n{}',
        });
        assert.deepEqual(await readConfigFile(join(root, 'package.json')), { extends: ['go'] });
        assert.equal(findConfig(join(root, 'sub'))?.projectDir, join(root, 'sub'));
    });

    it('says which file is not JSON', async () => {
        const root = folder({ 'crowded-folders.config.json': '{ "a": }' });
        await assert.rejects(
            readConfigFile(join(root, 'crowded-folders.config.json')),
            /crowded-folders\.config\.json is not valid JSON/u,
        );
    });
});

describe('resolveSpecifier', () => {
    it('follows exports conditions, main and subpaths', () => {
        const root = folder({
            'node_modules/a/package.json':
                '{ "exports": { ".": { "import": "./esm.js", "require": "./cjs.js" }, "./sub": "./sub.js" } }',
            'node_modules/@s/b/package.json': '{ "main": "lib" }',
            'node_modules/@s/b/lib/index.js': '',
            'node_modules/c/package.json': '{ "exports": "./only.js" }',
            'deep/x/.keep': '',
        });
        assert.equal(resolveSpecifier('a', join(root, 'deep/x')), join(root, 'node_modules/a/esm.js'));
        assert.equal(resolveSpecifier('a/sub', root), join(root, 'node_modules/a/sub.js'));
        assert.equal(resolveSpecifier('@s/b', root), join(root, 'node_modules/@s/b/lib/index.js'));
        assert.throws(() => resolveSpecifier('c/x', root), /does not export "\.\/x"/u);
        assert.throws(() => resolveSpecifier('./nope.js', root), /does not exist/u);
    });
});

describe('listFiles', () => {
    it('asks git: tracked and untracked files, without ignored or deleted ones', () => {
        const root = folder({
            '.gitignore': 'ignored/\n',
            'a.ts': '',
            'src/b.ts': '',
            'ignored/c.ts': '',
            'gone.ts': '',
        });
        const git = (...args: string[]): void => {
            execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
        };
        git('init', '-q');
        git('add', 'a.ts', 'gone.ts', '.gitignore');
        rmSync(join(root, 'gone.ts'));
        const list = listFiles(root, { git: true });
        assert.equal(list.source, 'git');
        assert.deepEqual(
            [...list.files].toSorted((a, b) => a.localeCompare(b)),
            ['.gitignore', 'a.ts', 'src/b.ts'],
        );
    });

    it('leaves out what .gitattributes marks as generated or vendored (bufbuild/buf private/gen)', () => {
        const root = folder({
            '.gitattributes':
                '/private/gen/** linguist-generated=true\nthird/** linguist-vendored\nkept/** -linguist-generated\n',
            'private/gen/proto/buf/alpha/v1/image.pb.go': '',
            'private/buf/cmd/buf.go': '',
            'third/lib.c': '',
            'kept/x.go': '',
        });
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' });
        assert.deepEqual(
            [...listFiles(root, { git: true }).files].toSorted((a, b) => a.localeCompare(b)),
            ['.gitattributes', 'kept/x.go', 'private/buf/cmd/buf.go'],
        );
    });

    it('walks the disk without git, skipping version control and node_modules', () => {
        const root = folder({ 'a.ts': '', 'node_modules/x/y.js': '', 'src/b.ts': '' });
        const list = listFiles(root, { git: false });
        assert.equal(list.source, 'filesystem');
        assert.deepEqual(
            [...list.files].toSorted((a, b) => a.localeCompare(b)),
            ['a.ts', 'src/b.ts'],
        );
    });

    it('reads a list from text, one path per line or NUL-separated, as given', () => {
        assert.deepEqual(parseFileList('a.ts\r\n./src/b.ts\n\nsrc/b.ts\n'), ['a.ts', './src/b.ts', 'src/b.ts']);
        assert.deepEqual(parseFileList('a.ts\0b c.ts\0'), ['a.ts', 'b c.ts']);
    });

    it('splits on a lone \\r too (classic Mac line ends read as one path)', () => {
        assert.deepEqual(parseFileList('a.ts\rsrc/b.ts\r'), ['a.ts', 'src/b.ts']);
    });
});

describe('listFiles when git cannot answer', () => {
    it('fails inside a repository whose git is broken, with what git said, instead of reading the disk', () => {
        // A .git file that points nowhere: what a broken GIT_DIR or a copied worktree looks like.
        const root = folder({ '.git': 'gitdir: ./nowhere\n', '.gitignore': 'build/\n', 'a.ts': '', 'build/x.ts': '' });
        assert.throws(
            () => listFiles(root, { git: true }),
            (error: unknown) => {
                assert.ok(error instanceof GitError, String(error));
                assert.match(error.message, /git could not list the files of .*\n {2}fatal: not a git repository/u);
                assert.match(error.message, /--no-git/u);
                return true;
            },
        );
    });

    it('reads the disk outside a repository and says so, unless git is required', () => {
        const root = folder({ 'a.ts': '' });
        const list = listFiles(root, { git: true });
        assert.equal(list.source, 'filesystem');
        assert.match(list.notice ?? '', /is not in a git repository: the files were read from the disk/u);
        assert.throws(() => listFiles(root, { git: true, requireGit: true }), GitError);
    });

    it('leaves out an untracked nested repository, which git lists as "nested/"', () => {
        const root = folder({ 'a.ts': '', 'nested/b.ts': '' });
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' });
        execFileSync('git', ['-C', join(root, 'nested'), 'init', '-q'], { stdio: 'ignore' });
        assert.deepEqual(listFiles(root, { git: true }).files, ['a.ts']);
    });
});

describe('listFiles without git', () => {
    it('reads .gitignore files, nested ones from their folder (--no-git counted android/build)', () => {
        const root = folder({
            '.gitignore': '*.log\n!keep.log\n',
            'android/.gitignore': 'build/\n/local.properties\n',
            'android/app/build/intermediates/x.dex': '',
            'android/app/src/Main.kt': '',
            'android/local.properties': '',
            'android/app/local.properties': '',
            'debug.log': '',
            'keep.log': '',
        });
        assert.deepEqual(listFiles(root, { git: false }).files, [
            '.gitignore',
            'android/.gitignore',
            'android/app/local.properties',
            'android/app/src/Main.kt',
            'keep.log',
        ]);
    });

    it('reads the .gitignore files above the root, up to the top of the repository', () => {
        const top = folder({
            '.git/info/exclude': 'secret.txt\n',
            '.gitignore': 'android/app/build\n',
            'android/app/build/x.dex': '',
            'android/app/Main.kt': '',
            'android/secret.txt': '',
        });
        assert.deepEqual(listFiles(join(top, 'android'), { git: false }).files, ['app/Main.kt']);
    });
});

describe('locate', () => {
    it('looks for the configuration from --root, not from where the command runs', () => {
        const top = folder({
            'here/crowded-folders.config.json': '{}',
            'other/crowded-folders.config.json': '{}',
            'other/a.ts': '',
        });
        const found = locate({ cwd: join(top, 'here'), root: join(top, 'other') });
        assert.equal(found.configPath, join(top, 'other', 'crowded-folders.config.json'));
        assert.equal(found.root, join(top, 'other'));
        assert.equal(found.scope, '.');
    });

    it('keeps the configuration as the base of paths when the root is inside its folder (QR Checker --root android)', () => {
        const top = folder({ '.config/crowded-folders.json': '{}', 'android/app/a.kt': '' });
        const found = locate({ cwd: top, root: join(top, 'android') });
        assert.equal(found.configPath, join(top, '.config', 'crowded-folders.json'));
        assert.equal(found.base, top);
        assert.equal(found.scope, 'android');
    });

    it(
        'reads every folder as its real path, so a short or differently cased one is the same folder',
        { skip: process.platform !== 'win32' },
        () => {
            const top = folder({ 'a.ts': '' });
            const found = locate({ cwd: top.toUpperCase() });
            assert.equal(found.root, realpathSync.native(top));
        },
    );
});
