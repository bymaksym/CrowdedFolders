import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

import { HELP } from './help.ts';
import type { Io } from './io.ts';
import { run } from './main.ts';

const roots: string[] = [];
after(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A repository on disk (without git: the file list comes from walking it). */
function repository(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'crowded-folders-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

interface Ran {
    readonly code: number;
    readonly out: string;
    readonly err: string;
}

async function cli(
    cwd: string,
    args: readonly string[],
    stdin = '',
    env: Readonly<Record<string, string>> = {},
): Promise<Ran> {
    let out = '';
    let error = '';
    const io: Io = {
        cwd,
        env,
        stdoutIsTTY: false,
        write: text => {
            out += text;
        },
        error: text => {
            error += text;
        },
        readStdin: () => Promise.resolve(stdin),
    };
    const code = await run(args, io);
    return { code, out, err: error };
}

const render = {
    'cli/render-json.ts': '',
    'cli/render-text.ts': '',
    'cli/render-sarif.ts': '',
    'cli/render-pr.ts': '',
    'cli/main.ts': '',
};

describe('the command', () => {
    it('finds a prefix group with no configuration, says which presets it used, and fails', async () => {
        const root = repository(render);
        const ran = await cli(root, []);
        assert.equal(ran.code, 1);
        assert.match(ran.out, /cli\/\n {2}✖ error {2}prefix-groups {2}4 modules start with "render"/u);
        assert.match(ran.err, /No configuration file: used the presets detected — recommended/u);
    });

    it('passes a clean repository', async () => {
        const root = repository({ 'src/a.ts': '', 'src/b.ts': '' });
        const ran = await cli(root, []);
        assert.equal(ran.code, 0);
        assert.match(ran.out, /No crowded folders/u);
    });

    it('reads its configuration from upwards, and resolves the root to the configuration folder', async () => {
        const root = repository({
            ...render,
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                overrides: [
                    { folders: ['cli'], reason: 'renderers are one family', rules: { 'prefix-groups': 'off' } },
                ],
            }),
        });
        const ran = await cli(join(root, 'cli'), []);
        assert.equal(ran.code, 0, ran.out + ran.err);
        assert.doesNotMatch(ran.err, /No configuration file/u);
    });

    it('rejects a configuration with a problem, saying where, with exit code 2', async () => {
        const root = repository({
            ...render,
            'crowded-folders.config.json': '{ "overrides": [{ "folders": ["cli"] }] }',
        });
        const ran = await cli(root, []);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /overrides\[0\]: needs "reason"/u);
    });

    it('refuses two configurations in one folder', async () => {
        const root = repository({
            'crowded-folders.config.json': '{}',
            'crowded-folders.config.jsonc': '{}',
            'a.ts': '',
        });
        const ran = await cli(root, []);
        assert.equal(ran.code, 2);
        assert.match(ran.err, /more than one crowded-folders configuration/u);
    });

    it('reads the file list from standard input', async () => {
        const root = repository({});
        const ran = await cli(root, ['--stdin', '--format', 'json'], Object.keys(render).join('\n'));
        assert.equal(ran.code, 1);
        const json = JSON.parse(ran.out) as { findings: { key: string }[]; summary: { filesChecked: number } };
        assert.equal(json.findings[0]?.key, 'render');
        assert.equal(json.summary.filesChecked, 5);
    });

    it('checks only the folders given, and accepts a file for its folder', async () => {
        const root = repository({
            ...render,
            ...Object.fromEntries(Object.keys(render).map(path => [path.replace('cli/', 'lib/'), ''])),
        });
        const ran = await cli(root, ['lib/main.ts', '--format', 'json']);
        const json = JSON.parse(ran.out) as { findings: { folder: string }[] };
        assert.deepEqual(
            json.findings.map(finding => finding.folder),
            ['lib'],
        );
        assert.equal((await cli(root, ['../elsewhere'])).code, 2);
    });

    it('adopts a repository with --suppress-all, then fails only on what is new or stale', async () => {
        const root = repository(render);
        const adopted = await cli(root, ['--suppress-all']);
        assert.equal(adopted.code, 0, adopted.out);
        const file = JSON.parse(readFileSync(join(root, 'crowded-folders-suppressions.json'), 'utf8')) as unknown;
        assert.deepEqual(file, { version: 1, suppressions: { cli: { 'prefix-groups#render': { count: 4 } } } });

        assert.equal((await cli(root, [])).code, 0);
        writeFileSync(join(root, 'cli/render-markdown.ts'), '');
        const grown = await cli(root, []);
        assert.equal(grown.code, 1);
        assert.match(grown.out, /it has grown/u);

        rmSync(join(root, 'cli/render-markdown.ts'));
        rmSync(join(root, 'cli/render-pr.ts'));
        const stale = await cli(root, []);
        assert.equal(stale.code, 1);
        assert.match(stale.out, /Suppressions nothing needs any more/u);
        assert.equal((await cli(root, ['--pass-on-unpruned-suppressions'])).code, 0);
        assert.equal((await cli(root, ['--prune-suppressions'])).code, 0);
        assert.deepEqual(JSON.parse(readFileSync(join(root, 'crowded-folders-suppressions.json'), 'utf8')), {
            version: 1,
            suppressions: {},
        });
    });

    it('fails on warnings only past --max-warnings, and --quiet hides them', async () => {
        const root = repository({
            ...render,
            'crowded-folders.config.json': '{ "rules": { "prefix-groups": "warn" } }',
        });
        assert.equal((await cli(root, [])).code, 0);
        assert.equal((await cli(root, ['--max-warnings', '0'])).code, 1);
        assert.match((await cli(root, ['--quiet'])).out, /✔ No errors \(.*; 1 warning hidden by --quiet\)/u);
    });

    it('writes the report to a file with --output', async () => {
        const root = repository(render);
        const ran = await cli(root, ['--format', 'sarif', '--output', 'report.sarif']);
        assert.equal(ran.out, '');
        assert.match(readFileSync(join(root, 'report.sarif'), 'utf8'), /"version": "2.1.0"/u);
    });

    it('init writes a configuration with the presets it detects, and will not overwrite one', async () => {
        const root = repository({ ...render, 'Cargo.toml': '[package]', 'src/main.rs': '' });
        const ran = await cli(root, ['init']);
        assert.equal(ran.code, 0, ran.err);
        const config = JSON.parse(readFileSync(join(root, 'crowded-folders.config.json'), 'utf8')) as {
            extends: string[];
            $schema: string;
        };
        assert.deepEqual(config.extends, ['recommended', 'rust']);
        assert.match(config.$schema, /schema\.json$/u);
        assert.match(ran.out, /--suppress-all/u);
        assert.equal((await cli(root, ['init'])).code, 2);
        assert.equal((await cli(root, ['init', '--force', '--preset', 'strict'])).code, 0);
        assert.deepEqual(
            (JSON.parse(readFileSync(join(root, 'crowded-folders.config.json'), 'utf8')) as { extends: string[] })
                .extends,
            ['strict'],
        );
    });

    it('explains a folder: modules, groups, rules and problems', async () => {
        const root = repository(render);
        const ran = await cli(root, ['explain', 'cli']);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.out, /render-json ← render-json\.ts {2}· render json {2}· render/u);
        assert.match(ran.out, /error prefix-groups/u);
        assert.equal((await cli(root, ['explain', 'nowhere'])).code, 2);
    });

    it('prints the configuration in effect, for the repository and for one folder', async () => {
        const root = repository(render);
        const whole = JSON.parse((await cli(root, ['print-config'])).out) as { layers: string[] };
        assert.deepEqual(whole.layers, ['preset "recommended"', '(the command line)']);
        const one = JSON.parse((await cli(root, ['print-config', '.'])).out) as { rules: Record<string, unknown> };
        assert.deepEqual(one.rules['max-files'], ['error', { max: 40, count: 'modules', dotfiles: false, hint: '' }]);
    });

    it('lists presets and rules', async () => {
        const root = repository({});
        assert.match((await cli(root, ['presets'])).out, /^recommended\n/u);
        assert.match((await cli(root, ['rules'])).out, /^max-files\n/u);
    });

    it('explains a wrong command line with exit code 2', async () => {
        const root = repository({});
        for (const args of [
            ['--nope'],
            ['--format', 'xml'],
            ['--max-warnings', '-1'],
            ['explain'],
            ['--stdin', '--no-git'],
            ['--color', '--no-color'],
        ]) {
            const ran = await cli(root, args);
            assert.equal(ran.code, 2, args.join(' '));
            assert.match(ran.err, /--help/u);
        }
    });

    it('prints help and version', async () => {
        const root = repository({});
        assert.equal((await cli(root, ['--help'])).out, HELP);
        assert.match((await cli(root, ['--version'])).out, /^\d+\.\d+\.\d+\n$/u);
    });
});

describe('the help', () => {
    it('lists every option the parser accepts', () => {
        const source = readFileSync(new URL('args.ts', import.meta.url), 'utf8');
        const options = [...source.matchAll(/^ {16}'?([a-z-]+)'?: \{ type:/gmu)].map(match => match[1]);
        assert.ok(options.length > 10);
        for (const option of options) {
            assert.ok(HELP.includes(`--${option ?? ''}`), `--${option ?? ''} is not in the help`);
        }
    });
});

/** A repository on disk with git, nothing committed: git lists the files as untracked. */
function gitRepository(files: Readonly<Record<string, string>>): string {
    const root = repository(files);
    git(root, 'init', '-q');
    return root;
}

function git(root: string, ...args: string[]): void {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

interface JsonReport {
    readonly findings: readonly { readonly folder: string; readonly rule: string }[];
    readonly summary: { readonly filesChecked: number; readonly foldersChecked: number };
}

describe('where it reads the files from', () => {
    it('fails with what git said inside a repository whose git is broken, instead of reading the disk', async () => {
        const root = repository({ '.git': 'gitdir: ./nowhere\n', '.gitignore': 'build/\n', ...render });
        const ran = await cli(root, []);
        assert.equal(ran.code, 2);
        assert.equal(ran.out, '');
        assert.match(ran.err, /git could not list the files .*\n {2}fatal: not a git repository/u);
    });

    it('says it read the disk outside a repository, and fails on CI unless --no-git says to', async () => {
        const root = repository(render);
        const plain = await cli(root, []);
        assert.equal(plain.code, 1);
        assert.match(plain.err, /is not in a git repository: the files were read from the disk/u);
        const ci = await cli(root, [], '', { CI: 'true' });
        assert.equal(ci.code, 2);
        assert.match(ci.err, /pass --no-git/u);
        const disk = await cli(root, ['--no-git'], '', { CI: 'true' });
        assert.equal(disk.code, 1);
        assert.doesNotMatch(disk.err, /not in a git repository/u);
        assert.equal((await cli(root, ['--require-git'])).code, 2);
    });

    it('reads its configuration and plugins from --root, not from where it runs (limit 3 here, 100 there)', async () => {
        const top = repository({
            'here/crowded-folders.config.json':
                '{ "extends": ["recommended"], "rules": { "max-files": ["error", { "max": 3 }] } }',
            'other/crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                plugins: ['./plugin.mjs'],
                rules: { 'max-files': ['error', { max: 100 }], 'p/root': 'warn' },
            }),
            'other/plugin.mjs':
                "export default { meta: { name: 'p', namespace: 'p' }, rules: { root: { meta: { description: 'x', defaultOptions: {} }, check(folder, { report }) { if (folder.path === '.') report({ message: 'the plugin of other' }); } } } };",
            ...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`other/src/m${index}.ts`, ''])),
        });
        const ran = await cli(join(top, 'here'), ['--root', '../other', '--no-git']);
        assert.equal(ran.code, 0, ran.out + ran.err);
        assert.match(ran.out, /the plugin of other/u);
        assert.doesNotMatch(ran.out, /max-files/u);
        assert.match(ran.err, /configuration .*other.crowded-folders\.config\.json, root .*other/u);
    });

    it('reads the patterns of a configuration above --root from its own folder (QR Checker --no-git --root android)', async () => {
        const top = repository({
            '.config/crowded-folders.json': '{ "extends": ["recommended"], "exclude": ["android/app/build"] }',
            ...Object.fromEntries(
                Array.from({ length: 25 }, (_, index) => [`android/app/build/intermediates/render-${index}.dex`, '']),
            ),
            'android/app/src/Main.kt': '',
            'web/render-a.ts': '',
            'web/render-b.ts': '',
            'web/render-c.ts': '',
            'web/render-d.ts': '',
        });
        const ran = await cli(top, ['--no-git', '--root', 'android', '--format', 'json']);
        assert.equal(ran.code, 0, ran.out + ran.err);
        const json = JSON.parse(ran.out) as JsonReport;
        assert.deepEqual(json.findings, [], 'web/ is not under the root, and android/app/build is excluded');
        assert.equal(json.summary.filesChecked, 1);
        assert.match(ran.err, /configuration \.config.crowded-folders\.json, root android; its paths start at \./u);

        writeFileSync(
            join(top, '.config/crowded-folders.json'),
            '{ "extends": ["recommended"], "exclude": ["/android"] }',
        );
        const excluded = await cli(top, ['--no-git', '--root', 'android']);
        assert.equal(excluded.code, 2);
        assert.match(excluded.err, /leaves out android \("\/android" in exclude/u);
    });

    it('reads --stdin from a sub-folder the way git ls-files prints it there (src/lib became lib/)', async () => {
        const root = gitRepository({
            ...Object.fromEntries(Object.keys(render).map(path => [`src/${path}`, ''])),
            'src/a.ts': '',
        });
        const fromHere = await cli(join(root, 'src'), ['--stdin', '--format', 'json'], Object.keys(render).join('\n'));
        assert.deepEqual(
            (JSON.parse(fromHere.out) as JsonReport).findings.map(finding => finding.folder),
            ['src/cli'],
        );
        const fromRoot = Object.keys(render)
            .map(path => `src/${path}`)
            .join('\n');
        const asDiff = await cli(join(root, 'src'), ['--stdin', '--format', 'json'], fromRoot);
        assert.deepEqual(
            (JSON.parse(asDiff.out) as JsonReport).findings.map(finding => finding.folder),
            ['src/cli'],
        );
    });

    it('reads absolute paths in --stdin from the root, and refuses those elsewhere (C:\\repo\\src made C:/repo/src)', async () => {
        const root = repository(render);
        const absolute = Object.keys(render)
            .map(path => join(root, path))
            .join('\n');
        const ran = await cli(root, ['--stdin', '--format', 'json'], absolute);
        assert.deepEqual(
            (JSON.parse(ran.out) as JsonReport).findings.map(finding => finding.folder),
            ['cli'],
        );
        const elsewhere = await cli(root, ['--stdin'], `${join(tmpdir(), 'elsewhere', 'a.ts')}\nb.ts`);
        assert.equal(elsewhere.code, 2);
        assert.match(elsewhere.err, /is absolute and not under the root/u);
    });

    it('leaves out of --stdin what .gitattributes marks generated, as the run from git does', async () => {
        const root = gitRepository({
            '.gitattributes': '**/__generated__/** linguist-generated\n',
            ...Object.fromEntries(Object.keys(render).map(path => [path.replace('cli/', 'src/__generated__/'), ''])),
        });
        const list = Object.keys(render).map(path => path.replace('cli/', 'src/__generated__/'));
        const ran = await cli(root, ['--stdin', '--format', 'json'], ['.gitattributes', ...list].join('\n'));
        assert.equal(ran.code, 0, ran.out);
        assert.deepEqual((JSON.parse(ran.out) as JsonReport).findings, []);
    });

    it('leaves out a tree ten thousand folders deep with a notice, instead of overflowing the stack', async () => {
        const root = repository({});
        const deep = `${Array.from({ length: 10_000 }, () => 'd').join('/')}/x.ts`;
        const ran = await cli(root, ['--stdin'], `${deep}\na.ts\n`);
        assert.equal(ran.code, 0, ran.err);
        assert.match(ran.err, /1 file deeper than 256 folders left out/u);
        assert.match(ran.out, /1 file checked/u);
    });

    it('takes no evidence from a folder every run leaves out (.cxx, the CMake cache, is not C++)', async () => {
        const root = repository({
            'android/app/build.gradle': '',
            'android/app/.cxx/Debug/3x4y/arm64-v8a/CMakeLists.txt': '',
            'android/app/src/main/Main.kt': '',
        });
        const ran = await cli(root, []);
        assert.match(ran.err, /used the presets detected — recommended .*java \(android\/app\/build\.gradle\)/u);
        assert.doesNotMatch(ran.err, /c-cpp/u);
    });
});

describe('what the configuration selects', () => {
    it('reads include like exclude: a folder takes everything in it, and an include that takes nothing is exit 2', async () => {
        const root = repository({
            ...render,
            'other/a.ts': '',
            'crowded-folders.config.json': '{ "extends": ["recommended"], "include": ["cli"] }',
        });
        const ran = await cli(root, ['--format', 'json']);
        assert.equal(ran.code, 1, ran.err);
        assert.equal((JSON.parse(ran.out) as JsonReport).summary.filesChecked, 5);

        writeFileSync(
            join(root, 'crowded-folders.config.json'),
            '{ "extends": ["recommended"], "include": ["nowhere"] }',
        );
        const none = await cli(root, []);
        assert.equal(none.code, 2);
        assert.match(none.err, /include: "nowhere" takes none of the 7 files listed/u);
    });

    it('lets src/app/** take src/app itself', async () => {
        const root = repository({
            ...render,
            'crowded-folders.config.json': JSON.stringify({
                extends: ['recommended'],
                overrides: [
                    { folders: ['cli/**'], reason: 'renderers are one family', rules: { 'prefix-groups': 'off' } },
                ],
            }),
        });
        assert.equal((await cli(root, [])).code, 0);
    });

    it('says when an exclude matches nothing, and when a "!x" removes nothing', async () => {
        const root = repository({
            ...render,
            'crowded-folders.config.json':
                '{ "extends": ["recommended"], "exclude": ["nowhere", "!generated", "!dist"] }',
        });
        const ran = await cli(root, []);
        assert.match(ran.err, /"nowhere" in exclude matches no file/u);
        assert.match(ran.err, /"!generated" in exclude removes nothing: .* not a gitignore negation/u);
        assert.doesNotMatch(ran.err, /"!dist"/u, '"!dist" removes the dist recommended leaves out');
    });

    it('says that an empty configuration turns no rule on', async () => {
        const root = repository({ ...render, 'crowded-folders.config.json': '{}' });
        const ran = await cli(root, []);
        assert.equal(ran.code, 0);
        assert.match(
            ran.err,
            /no rule is on in crowded-folders\.config\.json, so nothing is checked: missing "extends": \["recommended"\]\?/u,
        );
    });
});

describe('folders on the command line', () => {
    const tree = { ...render, 'src/lib/a.ts': '', 'src/lib/b.ts': '' };

    it('is exit 2, with the closest name, for a folder that does not exist', async () => {
        const root = repository(tree);
        for (const [args, said] of [
            [['src/no-existe'], /src\/no-existe does not exist\n/u],
            [['src/lbi'], /src\/lbi does not exist; did you mean src\/lib\?/u],
            [['SRC/LIB'], /did you mean src\/lib\?/u],
            [['explian', 'cli'], /explian is not a folder here; did you mean the command explain\?/u],
            [['help'], /for the help, run crowded-folders --help/u],
        ] as const) {
            const ran = await cli(root, args);
            assert.equal(ran.code, 2, args.join(' '));
            assert.match(ran.err, said, args.join(' '));
        }
    });

    it('checks the folder of a file that is gone, as git diff --name-only lists a deletion', async () => {
        const root = repository(tree);
        const ran = await cli(root, ['cli/gone.ts']);
        assert.equal(ran.code, 1);
        assert.match(ran.out, /prefix-groups/u);
    });

    it('counts what was checked, not the whole repository', async () => {
        const root = repository(tree);
        const ran = await cli(root, ['src/lib']);
        assert.match(ran.out, /\(1 folder and 2 files checked\)/u);
    });

    it(
        'takes a Windows short name for the same folder as its long name',
        { skip: process.platform !== 'win32' },
        async context => {
            const top = repository({});
            const long = join(top, 'a folder with a long name');
            mkdirSync(join(long, 'cli'), { recursive: true });
            for (const path of Object.keys(render)) {
                writeFileSync(join(long, path), '');
            }
            const short = spawnSync('cmd', ['/d', '/s', '/c', `"for %I in ("${long}") do @echo %~sI"`], {
                encoding: 'utf8',
                windowsVerbatimArguments: true,
            }).stdout.trim();
            if (short.toLowerCase() === long.toLowerCase()) {
                context.skip('this volume makes no short names');
                return;
            }
            const ran = await cli(long, [join(short, 'cli'), '--no-git']);
            assert.equal(ran.code, 1, ran.err);
            assert.match(ran.out, /prefix-groups/u);
        },
    );
});

describe('--output and the files it writes', () => {
    it('is a usage error, not a crash, for a folder', async () => {
        const root = repository({ ...render, 'out/.keep': '' });
        const folder = await cli(root, ['-o', 'out']);
        assert.equal(folder.code, 2);
        assert.match(folder.err, /is a folder; give the file to write in it/u);
        assert.doesNotMatch(folder.err, /this is a bug/u);
        assert.equal((await cli(root, ['-o', 'newdir/'])).code, 2);
    });

    it('will not write over a file git tracks, or over the configuration, without --force', async () => {
        const root = gitRepository({
            ...render,
            'src/other.ts': 'code',
            'crowded-folders.config.json': '{ "extends": ["recommended"] }',
        });
        git(root, 'add', 'src/other.ts');
        const tracked = await cli(root, ['-o', 'src/other.ts']);
        assert.equal(tracked.code, 2);
        assert.match(tracked.err, /git tracks .*other\.ts/u);
        assert.equal(readFileSync(join(root, 'src/other.ts'), 'utf8'), 'code');
        const config = await cli(root, ['-o', 'crowded-folders.config.json']);
        assert.equal(config.code, 2);
        assert.match(config.err, /is the configuration/u);
        assert.equal((await cli(root, ['-o', 'src/other.ts', '--force'])).code, 1);
        assert.match(readFileSync(join(root, 'src/other.ts'), 'utf8'), /prefix-groups/u);

        // The same for every report of a run with several: -f format=file is an --output too.
        git(root, 'checkout', '--', 'src/other.ts');
        const several = await cli(root, ['-f', 'text', '-f', 'json=src/other.ts']);
        assert.equal(several.code, 2);
        assert.match(several.err, /--format json=src\/other\.ts: git tracks .*other\.ts/u);
        assert.equal(readFileSync(join(root, 'src/other.ts'), 'utf8'), 'code');
        assert.equal((await cli(root, ['-f', 'sarif=out/'])).code, 2);
    });

    it('reads every path option from the current folder, and says when it writes outside the root', async () => {
        const top = repository({});
        const root = join(top, 'repo');
        for (const path of [...Object.keys(render), 'sub/a.ts']) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), '');
        }
        writeFileSync(join(root, 'crowded-folders.config.json'), '{ "extends": ["recommended"] }');
        const sub = join(root, 'sub');
        assert.equal((await cli(sub, ['--suppress-all', '--suppressions-location', 'mine.json'])).code, 0);
        assert.match(readFileSync(join(sub, 'mine.json'), 'utf8'), /prefix-groups#render/u);
        const outside = await cli(sub, ['-o', '../../report.txt']);
        assert.match(outside.err, /wrote .*report\.txt, outside the folder being checked/u);
        assert.match(readFileSync(join(top, 'report.txt'), 'utf8'), /prefix-groups/u);
    });
});
