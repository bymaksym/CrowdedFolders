// @ts-check
/**
 * Builds a single-file executable of the command with Node's single executable applications (SEA): the
 * built dist/ bundled into one script, and that script injected into a copy of the Node that runs this.
 * The result needs no Node on the machine that runs it.
 *
 * esbuild and postject are run through npx, pinned, and are not dependencies of this package: the
 * published package has no runtime dependency, and the binary is not part of it. The release workflow
 * (.github/workflows/binaries.yml) runs this on each platform, because a binary is its platform's Node.
 *
 * Usage: node tooling/build-binary.mjs [--out binaries] [--name crowded-folders]
 *        (dist/ must be built; the executable is written to <out>/<name>[.exe])
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ESBUILD = 'esbuild@0.28.2';
const POSTJECT = 'postject@1.0.0-alpha.6';
/** Fixed by Node: the marker postject flips to tell the Node binary that a blob is attached. */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const { values } = parseArgs({
    options: { out: { type: 'string', default: 'binaries' }, name: { type: 'string', default: 'crowded-folders' } },
});
const repository = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
const work = join(repository, '.sea');
const windows = process.platform === 'win32';
const macos = process.platform === 'darwin';
const executable = join(resolve(repository, values.out), `${values.name}${windows ? '.exe' : ''}`);

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ capture?: boolean }} [options]
 */
function run(command, args, options = {}) {
    console.log(`$ ${command} ${args.join(' ')}`);
    /** @type {import('node:child_process').StdioOptions} */
    const stdio = options.capture ? 'pipe' : ['ignore', 'inherit', 'inherit'];
    // npx is a .cmd on Windows, which only a shell runs: one quoted string, as test-package.mjs does it.
    const result =
        windows && command === 'npx'
            ? spawnSync([command, ...args.map(arg => `"${arg.replaceAll('"', '\\"')}"`)].join(' '), {
                  cwd: repository,
                  shell: true,
                  encoding: 'utf8',
                  stdio,
              })
            : spawnSync(command, args, { cwd: repository, encoding: 'utf8', stdio });
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args[0] ?? ''} failed (${result.status ?? result.error?.message}): ${result.stderr ?? ''}`,
        );
    }
    return result.stdout ?? '';
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(resolve(executable, '..'), { recursive: true });

// 1. One script. A SEA runs a CommonJS script, so the ES modules are bundled into one; the version has
//    no package.json to be read from, so it is written in (src/node/modules.ts reads the constant).
const entry = join(work, 'entry.mjs');
// The entry is beside dist/ so that esbuild resolves it as a relative import.
writeFileSync(
    entry,
    [
        "import { run } from '../dist/cli/main.js';",
        'run(process.argv.slice(2)).then(code => {',
        '    process.exitCode = code;',
        '});',
        '',
    ].join('\n'),
);
run('npx', [
    '--yes',
    ESBUILD,
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--legal-comments=none',
    // The value is a JSON string.
    `--define:CROWDED_FOLDERS_BUNDLED_VERSION="${manifest.version}"`,
    `--outfile=${join(work, 'crowded-folders.cjs')}`,
]);

// 2. The blob, made by the Node that will carry it. No code cache: it would tie the blob to a platform.
writeFileSync(
    join(work, 'sea-config.json'),
    JSON.stringify({
        main: join(work, 'crowded-folders.cjs'),
        output: join(work, 'sea.blob'),
        disableExperimentalSEAWarning: true,
    }),
);
run(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')]);

// 3. A copy of this Node with the blob injected. Nothing is signed with an identity; macOS will not run
//    a modified binary without at least an ad hoc signature, so that one is made.
copyFileSync(process.execPath, executable);
chmodSync(executable, 0o755);
if (macos) run('codesign', ['--remove-signature', executable]);
run('npx', [
    '--yes',
    POSTJECT,
    executable,
    'NODE_SEA_BLOB',
    join(work, 'sea.blob'),
    '--sentinel-fuse',
    FUSE,
    ...(macos ? ['--macho-segment-name', 'NODE_SEA'] : []),
]);
if (macos) run('codesign', ['--sign', '-', executable]);

// 4. It runs, and it is this version.
const printed = run(executable, ['--version'], { capture: true }).trim();
if (printed !== manifest.version) {
    throw new Error(`${executable} --version printed "${printed}", expected ${manifest.version}`);
}
rmSync(work, { recursive: true, force: true });
console.log(
    `\n${executable}: ${(statSync(executable).size / 1_048_576).toFixed(1)} MiB, version ${printed}, Node ${process.versions.node}`,
);
