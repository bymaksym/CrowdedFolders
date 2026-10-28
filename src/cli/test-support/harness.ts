import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';

import type { Io } from '../io.ts';
import { run } from '../main.ts';

const roots: string[] = [];

/** Removes the repositories made with `repository` when the file's tests end. */
export function cleanUpAfterTests(): void {
    after(() => {
        for (const root of roots) {
            rmSync(root, { recursive: true, force: true });
        }
    });
}

/** A repository on disk (without git: the file list comes from walking it). */
export function repository(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'crowded-folders-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
    return root;
}

export interface Ran {
    readonly code: number;
    readonly out: string;
    readonly err: string;
}

/** Runs the command in a folder with the given environment, without a terminal. */
export async function cli(
    cwd: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> = {},
    stdin = '',
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

/** Four renderers that should be a folder, and one file that should not. */
export const RENDER_FILES = {
    'cli/render-json.ts': '',
    'cli/render-text.ts': '',
    'cli/render-sarif.ts': '',
    'cli/render-pr.ts': '',
    'cli/main.ts': '',
};
