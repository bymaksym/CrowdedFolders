import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Every place that names a version of this package, and how: the full version (`crowded-folders@1.0.1`,
 * `/blob/v1.0.1/`, a peer range) or only its major (`crowded-folders@1/schema.json`, `CrowdedFolders@v1`).
 */
const FULL = [
    /CrowdedFolders\/(?:blob|tree)\/v(\d+\.\d+\.\d+)/gu,
    /CrowdedFolders\/releases\/download\/v(\d+\.\d+\.\d+)/gu,
    /crowded-folders-v(\d+\.\d+\.\d+)-/gu,
    /crowded-folders@(\d+\.\d+\.\d+)/gu,
    /CrowdedFolders@v(\d+\.\d+\.\d+)/gu,
    /"crowded-folders": "\^(\d+\.\d+\.\d+)"/gu,
    /\brev: v(\d+\.\d+\.\d+)/gu,
    /^version=(\d+\.\d+\.\d+)$/gmu,
    /PACKAGE_VERSION = '(\d+\.\d+\.\d+)'/gu,
];
const MAJOR = [/crowded-folders@(\d+)\/schema\.json/gu, /CrowdedFolders@v(\d+)(?![\d.])/gu];

/** Files that name other versions on purpose: the history, the lockfile, and tests with versions of their own. */
const NOT_THIS_VERSION = [
    /^CHANGELOG\.md$/u,
    /^pnpm-lock\.yaml$/u,
    /\.test\.ts$/u,
    /^\.github\/release-please-manifest\.json$/u,
];

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(root(path), 'utf8');
const manifest = JSON.parse(read('package.json')) as { version: string };

interface Reference {
    readonly file: string;
    readonly line: number;
    readonly text: string;
    readonly found: string;
}

/** The references of a text that do not name `version`, or its major. */
function lagging(file: string, text: string, version: string): Reference[] {
    const major = version.split('.', 1)[0] ?? '';
    const out: Reference[] = [];
    const lines = text.split('\n');
    for (const [patterns, expected] of [
        [FULL, version],
        [MAJOR, major],
    ] as const) {
        for (const pattern of patterns) {
            for (const match of text.matchAll(pattern)) {
                if (match[1] === expected) {
                    continue;
                }

                const line = text.slice(0, match.index).split('\n').length;
                out.push({ file, line, text: (lines[line - 1] ?? '').trim(), found: match[1] ?? '' });
            }
        }
    }
    return out;
}

function trackedTextFiles(): string[] {
    const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root('.'), encoding: 'utf8' }).split('\0');
    return listed.filter(
        file =>
            /\.(?:md|json|jsonc|ya?ml|ts|mjs|js|cjs)$/u.test(file) &&
            NOT_THIS_VERSION.every(pattern => !pattern.test(file)),
    );
}

// ── What release-please does to a file, as release-please 17 does it ──────────────────────────────────
// src/updaters/generic.ts: on a line with x-release-please-<scope>, or between x-release-please-start-<scope>
// and x-release-please-end, the first version of the line (scope "version") or its first number (scope
// "major") is replaced. src/updaters/generic-json.ts: the first version in the string at a JSONPath.

const VERSION = /\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[-\w.]+)?/u;
const INLINE = /x-release-please-(major|minor|patch|version)\b/u;
const BLOCK_START = /x-release-please-start-(major|minor|patch|version)\b/u;

function replaceIn(line: string, scope: string, next: string): string {
    const [major = '', minor = '', patch = ''] = next.split('.', 3);
    switch (scope) {
        case 'major': {
            return line.replace(/\d+\b/u, () => major);
        }
        case 'minor': {
            return line.replace(/\b\d+\b/u, () => minor);
        }
        case 'patch': {
            return line.replace(/\b\d+\b/u, () => patch);
        }
        default: {
            return line.replace(VERSION, () => next);
        }
    }
}

function genericUpdate(text: string, next: string): string {
    let block: string | undefined;
    return text
        .split('\n')
        .map(line => {
            const inline = INLINE.exec(line);
            if (inline) {
                return replaceIn(line, inline[1] ?? 'version', next);
            }
            if (block !== undefined) {
                const replaced = replaceIn(line, block, next);
                if (line.includes('x-release-please-end')) {
                    block = undefined;
                }
                return replaced;
            }
            block = BLOCK_START.exec(line)?.[1];
            return line;
        })
        .join('\n');
}

/** The JSONPaths this repository uses: `$..key` (every key of that name) and `$.a.b` or `$.a['b']`. */
function jsonUpdate(text: string, jsonpath: string, next: string): string {
    const data = JSON.parse(text) as unknown;
    const replaceAt = (holder: Record<string, unknown>, key: string): void => {
        const value = holder[key];
        if (typeof value === 'string') {
            holder[key] = value.replace(VERSION, () => next);
        }
    };
    const everywhere = /^\$\.\.(\w+)$/u.exec(jsonpath);
    if (everywhere) {
        const key = everywhere[1] ?? '';
        const walk = (node: unknown): void => {
            if (node === null || typeof node !== 'object') {
                return;
            }

            for (const child of Object.values(node)) {
                walk(child);
            }
            if (!Array.isArray(node) && Object.hasOwn(node, key)) {
                replaceAt(node as Record<string, unknown>, key);
            }
        };
        walk(data);
    } else {
        const keys = [...jsonpath.slice(1).matchAll(/\.(\w+)|\['([^']+)'\]/gu)].map(
            match => match[1] ?? match[2] ?? '',
        );
        let holder = data as Record<string, unknown>;
        for (const key of keys.slice(0, -1)) {
            holder = holder[key] as Record<string, unknown>;
        }
        replaceAt(holder, keys.at(-1) ?? '');
    }
    return `${JSON.stringify(data, undefined, 4)}\n`;
}

/** The files of the release as release-please writes them for `next`; the others as they are. */
function released(files: readonly string[], next: string): Map<string, string> {
    type ExtraFile = string | { readonly type: string; readonly path: string; readonly jsonpath?: string };
    const config = JSON.parse(read('.github/release-please-config.json')) as {
        packages: Record<string, { 'extra-files'?: readonly ExtraFile[] }>;
    };
    const extra = config.packages['.']?.['extra-files'] ?? [];
    const out = new Map(files.map(file => [file, read(file)]));
    // The node strategy itself: the version of package.json.
    out.set('package.json', jsonUpdate(read('package.json'), '$.version', next));
    for (const entry of extra) {
        const path = typeof entry === 'string' ? entry : entry.path;
        const text = out.get(path) ?? read(path);
        if (typeof entry !== 'string') {
            assert.ok(['generic', 'json'].includes(entry.type), `${path}: an updater this test does not know`);
            out.set(
                path,
                entry.type === 'json' ? jsonUpdate(text, entry.jsonpath ?? '', next) : genericUpdate(text, next),
            );
        } else if (path.endsWith('.json')) {
            out.set(path, genericUpdate(jsonUpdate(text, '$.version', next), next));
        } else {
            out.set(path, genericUpdate(text, next));
        }
    }
    return out;
}

const show = (references: readonly Reference[]): string =>
    references
        .map(reference => `${reference.file}:${reference.line} names ${reference.found}: ${reference.text}`)
        .join('\n');

describe('the version this package names in its own files', () => {
    it('is the version of package.json everywhere: a link, a range or an example never lags behind', () => {
        const files = trackedTextFiles();
        const behind = files.flatMap(file => lagging(file, read(file), manifest.version));
        assert.deepEqual(behind, [], show(behind));
    });

    it('is the next version everywhere once release-please makes the release: every place is in extra-files and marked', () => {
        const major = Number(manifest.version.split('.', 1)[0]);
        for (const next of [`${major + 1}.0.0`, `${major}.${Number(manifest.version.split('.', 2)[1]) + 1}.0`]) {
            const files = trackedTextFiles();
            const after = released(files, next);
            const behind = [...after].flatMap(([file, text]) => lagging(file, text, next));
            assert.deepEqual(behind, [], `release ${next}:\n${show(behind)}`);
        }
    });
});
