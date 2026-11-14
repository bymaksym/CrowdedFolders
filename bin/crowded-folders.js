#!/usr/bin/env node
// @ts-check
// The executable. It only starts the compiled command, so that a missing build says what to do
// instead of failing on an import.
import { existsSync, readFileSync } from 'node:fs';
import module from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    // Answered here: loading the whole command for one line takes most of a second on Windows.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${manifest.version}\n`);
} else {
    const main = new URL('../dist/cli/main.js', import.meta.url);
    if (existsSync(fileURLToPath(main))) {
        // Node 22.1 and later keep the compiled code of dist/ between runs; Node 20 has no such cache, nor
        // its type: it is called only where it exists.
        const compiled = /** @type {{ enableCompileCache?: () => unknown }} */ (module);
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- optional call: absent on Node 20, nothing happens
        compiled.enableCompileCache?.();
        const { run } = await import(main.href);
        process.exitCode = await run(args);
    } else {
        const installed = fileURLToPath(import.meta.url).includes('node_modules');
        process.stderr.write(
            installed
                ? 'crowded-folders: this installation is incomplete (dist/ is missing). Install it again.\n'
                : 'crowded-folders: the command is not built yet. Run `pnpm run build` first.\n',
        );
        process.exitCode = 2;
    }
}
