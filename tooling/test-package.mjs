// @ts-check
/**
 * Installs the package from its tarball into an empty project and uses it the way a stranger would:
 * the executable, the API, what `exports` lets in and keeps out, and what the tarball carries.
 *
 * The tests import src/ with this repository around them; a user gets the tarball and nothing else.
 * Those are two different borders, and only this script crosses the second one. It runs on the oldest
 * Node in "engines" in CI, so it uses nothing newer than Node 20.19.
 *
 * Usage: node tooling/test-package.mjs [--tarball crowded-folders-x.y.z.tgz]
 *        (without --tarball it runs npm pack; dist/ must be built)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' } } });
const repository = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'crowded-folders-package-'));

/** @type {string[]} */
const failures = [];
/** @param {string} name @param {boolean} ok @param {string} [detail] */
function expect(name, ok, detail = '') {
    console.log(`${ok ? '✔' : '✘'} ${name}${ok || detail === '' ? '' : `\n    ${detail}`}`);
    if (!ok) failures.push(name);
}

/**
 * Makes a folder a git repository with its files committed: the repositories the tool meets are, and on
 * CI (CI is set on the runner) it refuses a folder outside one unless --no-git says to read the disk.
 * @param {string} folder
 */
function commitAll(folder) {
    for (const args of [
        ['init', '--quiet'],
        ['add', '--all'],
        [
            '-c',
            'user.name=test',
            '-c',
            'user.email=test@example.invalid',
            '-c',
            'commit.gpgsign=false',
            'commit',
            '--quiet',
            '-m',
            'sample',
        ],
    ]) {
        const git = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8' });
        if (git.status !== 0) {
            throw new Error(`git ${args.join(' ')} in ${folder}: ${git.stderr}`);
        }
    }
}

/**
 * npm is a .cmd on Windows, which only a shell runs, so the command is one quoted string.
 *
 * @param {string[]} args
 * @param {string} cwd
 */
function npm(args, cwd) {
    return execSync(['npm', ...args.map(arg => `"${arg}"`)].join(' '), { cwd, encoding: 'utf8' });
}

try {
    let tarball = values.tarball;
    if (tarball === undefined) {
        if (!existsSync(join(repository, 'dist', 'cli', 'main.js'))) {
            throw new Error('dist/ is not built: run pnpm run build first');
        }
        const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', work], repository));
        tarball = join(work, packed[0].filename);
    }
    tarball = resolve(tarball);

    // What the tarball carries.
    const listing = JSON.parse(npm(['pack', '--dry-run', '--json'], repository))[0].files.map(
        (/** @type {{ path: string }} */ file) => file.path,
    );
    for (const required of [
        'bin/crowded-folders.js',
        'dist/index.js',
        'dist/index.d.ts',
        'dist/eslint.js',
        'dist/cli/main.js',
        '.claude-plugin/plugin.json',
        'hooks/hooks.json',
        'skills/crowded-folders/SKILL.md',
        'schema.json',
        'report.schema.json',
        'README.md',
        'LICENSE',
    ]) {
        expect(`the tarball has ${required}`, listing.includes(required));
    }
    const leaked = listing.filter((/** @type {string} */ path) =>
        /^(?:src|tooling|examples|\.github|\.config|\.field-trial)\/|\.test\.(?:js|d\.ts)$/u.test(path),
    );
    expect('the tarball has no sources, tests or tooling', leaked.length === 0, leaked.join(', '));

    // An empty project that installs it.
    const consumer = join(work, 'consumer');
    mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
    npm(['install', tarball, '--no-audit', '--no-fund', '--loglevel', 'error'], consumer);
    const bin = join(consumer, 'node_modules', 'crowded-folders', 'bin', 'crowded-folders.js');

    /** @param {string[]} args @param {string} cwd */
    const run = (args, cwd) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });

    const version = run(['--version'], consumer);
    expect(
        `--version prints ${manifest.version}`,
        version.stdout.trim() === manifest.version,
        version.stdout + version.stderr,
    );

    // A repository with a group that was never made a folder.
    const sample = join(work, 'sample');
    for (const name of ['render-json.ts', 'render-text.ts', 'render-pr.ts', 'render-sarif.ts', 'main.ts']) {
        mkdirSync(join(sample, 'cli'), { recursive: true });
        writeFileSync(join(sample, 'cli', name), '');
    }
    commitAll(sample);
    const found = run(['--no-color'], sample);
    expect(
        'it finds the render group and exits 1',
        found.status === 1 && found.stdout.includes('prefix-groups'),
        found.stdout + found.stderr,
    );

    // The ESLint plugin, with the context ESLint would give it, over the same repository.
    const plugin = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            "import plugin from 'crowded-folders/eslint';" +
                'const reports = [];' +
                `const context = { filename: ${JSON.stringify(join(sample, 'cli', 'main.ts'))}, cwd: ${JSON.stringify(sample)}, options: [], report: r => reports.push(r) };` +
                'plugin.rules.folder.create(context).Program();' +
                "if (reports.length !== 1 || !reports[0].data.message.includes('render') || plugin.configs.recommended.plugins['crowded-folders'] !== plugin) process.exit(1);",
        ],
        { cwd: consumer, encoding: 'utf8' },
    );
    expect('crowded-folders/eslint reports the render group', plugin.status === 0, plugin.stderr);

    const init = run(['init'], sample);
    expect(
        'init writes a configuration',
        init.status === 0 && existsSync(join(sample, 'crowded-folders.config.json')),
        init.stdout + init.stderr,
    );
    // On the CI runner CI is set, where writing suppressions is refused without --force.
    const adopted = run(['--suppress-all', '--force'], sample);
    expect('--suppress-all adopts it and exits 0', adopted.status === 0, adopted.stdout + adopted.stderr);
    const sarif = run(['--format', 'sarif', '--pass-on-unpruned-suppressions'], sample);
    expect('--format sarif prints SARIF', sarif.stdout.includes('"version": "2.1.0"'), sarif.stderr);

    // The kit for agents: the hook answers from the installed package, as the plugin and init --agents run it.
    const hookRun = spawnSync(process.execPath, [bin, 'hook', 'claude'], {
        cwd: sample,
        encoding: 'utf8',
        input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'Write',
            cwd: sample,
            tool_input: { file_path: join(sample, 'cli', 'render-extra.ts'), content: '' },
        }),
    });
    expect(
        'the hook warns about a new file and does not decide',
        hookRun.status === 0 &&
            hookRun.stdout.includes('"additionalContext"') &&
            !hookRun.stdout.includes('permissionDecision'),
        hookRun.stdout + hookRun.stderr,
    );
    const where = run(['where', 'cli/render-extra.ts', '--format', 'json'], sample);
    expect(
        'where answers in JSON',
        where.status === 0 && where.stdout.includes('"effect"'),
        where.stdout + where.stderr,
    );
    const agents = run(['init', '--agents', '--dry-run'], sample);
    expect(
        'init --agents --dry-run prints a diff',
        agents.status === 0 && agents.stdout.includes('+++ b/.claude/settings.json'),
        agents.stdout + agents.stderr,
    );

    const broken = join(work, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, 'crowded-folders.config.json'), '{ "overrides": [{ "folders": ["a"] }] }');
    writeFileSync(join(broken, 'a.ts'), '');
    commitAll(broken);
    const rejected = run([], broken);
    expect(
        'a configuration without a reason exits 2',
        rejected.status === 2 && rejected.stderr.includes('needs "reason"'),
        rejected.stderr,
    );

    // The API, through "exports".
    /** @param {string} code */
    const node = code =>
        spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: consumer, encoding: 'utf8' });
    const api = node(
        "import { lint, defineRule, BUILT_IN_PRESETS } from 'crowded-folders';" +
            "const r = await lint({ files: ['a/xyz-1.ts','a/xyz-2.ts','a/xyz-3.ts','a/xyz-4.ts','a/y.ts'], config: { extends: ['recommended'] } });" +
            "if (typeof defineRule !== 'function' || !BUILT_IN_PRESETS.go || r.findings[0]?.key !== 'xyz') process.exit(1);",
    );
    expect('the API imports and runs', api.status === 0, api.stderr);
    const engine = node(
        "import { runEngine, resolveConfig } from 'crowded-folders/engine';" +
            "const r = runEngine({ files: ['a/xyz-1.ts','a/xyz-2.ts','a/xyz-3.ts','a/xyz-4.ts','a/y.ts'], ...resolveConfig({ extends: ['recommended'] }) });" +
            "if (r.findings[0]?.key !== 'xyz') process.exit(1);",
    );
    expect('crowded-folders/engine imports and runs', engine.status === 0, engine.stderr);
    const testing = node(
        "import { RuleTester } from 'crowded-folders/testing'; import { BUILT_IN_RULES } from 'crowded-folders';" +
            "new RuleTester().run('max-files', BUILT_IN_RULES['max-files'], { invalid: [{ files: ['a/1.ts','a/2.ts'], options: { max: 1 }, errors: 1 }] });",
    );
    expect('crowded-folders/testing imports and runs', testing.status === 0, testing.stderr);
    for (const entry of ['dist/engine.d.ts', 'dist/eslint.d.ts', 'dist/testing.d.ts']) {
        expect(`the types of ${entry} are in the tarball`, listing.includes(entry));
    }
    const closed = node("await import('crowded-folders/dist/core/engine.js');");
    expect(
        'exports keeps dist/ internals out',
        closed.status !== 0 && closed.stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'),
        closed.stderr,
    );
    const schema = node(
        "import { createRequire } from 'node:module'; createRequire(import.meta.url).resolve('crowded-folders/schema.json');",
    );
    expect('schema.json can be resolved', schema.status === 0, schema.stderr);
    expect('the types are where package.json says', existsSync(join(dirname(bin), '..', 'dist', 'index.d.ts')));
} catch (error) {
    failures.push(String(error));
    console.error(error);
} finally {
    rmSync(work, { recursive: true, force: true });
}

console.log(
    failures.length === 0
        ? `\nThe package works on Node ${process.versions.node}.`
        : `\n${failures.length} check(s) failed.`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
