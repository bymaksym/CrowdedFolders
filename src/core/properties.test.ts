/**
 * Properties of paths, globs and suppressions, checked on generated inputs rather than examples.
 *
 * The generator is a few lines of seeded PRNG instead of fast-check: these properties need strings
 * built from a handful of awkward pieces (`..`, `\`, `./`, `__proto__`, case, dots), which a small
 * generator states directly, and a failure prints its seed and its input, so it is replayed with
 * `SEED=<n>` and needs no shrinking to read. A devDependency would buy shrinking and nothing else here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Finding } from './engine.ts';
import { compileGlob, compileGlobWith, globProblem, matchesSelfOrAncestor } from './paths/glob.ts';
import { normaliseFileList } from './paths/input.ts';
import { normalisePath } from './paths/tree.ts';
import { addSuppressions, applySuppressions, parseSuppressions, serialiseSuppressions } from './suppressions.ts';

const RUNS = 300;
const SEED = Number(process.env['SEED'] ?? 20_261_028);

/** mulberry32: small, fast, and the same sequence for the same seed on every machine. */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d_2b_79_f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

interface Gen {
    int(max: number): number;
    pick<T>(items: readonly T[]): T;
}

function generator(seed: number): Gen {
    const next = random(seed);
    return {
        int: max => Math.floor(next() * max),
        pick: items => items[Math.floor(next() * items.length)] as never,
    };
}

/** Runs a property `RUNS` times; a failure says the seed and the run, to replay it. */
function property(name: string, check: (gen: Gen) => void): void {
    it(name, () => {
        for (let run = 0; run < RUNS; run++) {
            const seed = SEED + run;
            try {
                check(generator(seed));
            } catch (error) {
                throw new Error(`${name}: fails with SEED=${seed}: ${(error as Error).message}`, { cause: error });
            }
        }
    });
}

const NAMES = [
    'src',
    'lib',
    'a',
    'B',
    'utils',
    '__proto__',
    'constructor',
    'v1.2',
    '.config',
    'x-y_z',
    'ÿ',
    'with space',
];

function segment(gen: Gen): string {
    return gen.pick(NAMES);
}

function cleanPath(gen: Gen, min = 1): string {
    return Array.from({ length: min + gen.int(4) }, () => segment(gen)).join('/');
}

/** The same path written the ways people and tools write it: `./`, `\`, doubled and trailing slashes, `x/..`. */
function noisy(gen: Gen, clean: string): string {
    const start = gen.pick(['', '', './']);
    return (
        start +
        clean
            .split('/')
            .map(part => {
                const prefix = gen.pick(['', '', './', 'x/../']);
                return `${prefix}${part}`;
            })
            .join(gen.pick(['/', '/', '\\', '//']))
    );
}

describe('paths (properties)', () => {
    property('normalising is idempotent and leaves no empty, "." or ".." segment', gen => {
        const path = noisy(gen, cleanPath(gen));
        const once = normalisePath(path);
        assert.equal(normalisePath(once ?? ''), once, path);
        for (const part of (once ?? '').split('/')) {
            assert.ok(part !== '.' && part !== '..' && !part.includes('\\'), `${path} → ${once}`);
        }
    });

    property('every way of writing a file of the root reads as the same file', gen => {
        const clean = cleanPath(gen);
        const { files, problems } = normaliseFileList([noisy(gen, clean), clean]);
        assert.deepEqual(problems, []);
        assert.deepEqual(files, [clean]);
    });

    property('a path that climbs above the root is always a problem, never a file', gen => {
        const path = `${'../'.repeat(1 + gen.int(3))}${cleanPath(gen)}`;
        const read = normaliseFileList([gen.pick([path, path.replaceAll('/', '\\'), `a/../${path}`])]);
        assert.deepEqual(read.files, []);
        assert.equal(read.problems.length, 1);
    });

    property('an absolute path under the root is made relative to it, in any case of the drive', gen => {
        const clean = cleanPath(gen);
        const root = gen.pick(['C:/repo', 'c:\\repo', '/home/me/repo']);
        const absolute = `${root.startsWith('/') ? root : gen.pick(['C:', 'c:'])}${root.startsWith('/') ? '' : '\\repo'}/${clean}`;
        assert.deepEqual(normaliseFileList([absolute], root).files, [clean], absolute);
    });
});

describe('globs (properties)', () => {
    property('a name without special characters matches itself at any depth, and only itself', gen => {
        const name = gen.pick(['src', 'lib', 'utils', 'x-y_z', 'v1.2', '__proto__']);
        const glob = compileGlob(name);
        const folder = gen.int(2) === 0 ? name : `${cleanPath(gen)}/${name}`;
        assert.ok(glob.test(folder), folder);
        assert.ok(!glob.test(`${folder}x`), `${folder}x`);
    });

    property('a folder excluded leaves out everything under it', gen => {
        const folder = cleanPath(gen);
        const path = `${folder}/${cleanPath(gen)}`;
        assert.ok(matchesSelfOrAncestor(path, [compileGlob(`/${folder}`)]), `${folder} ⊃ ${path}`);
        assert.ok(compileGlob(`${folder}/**`).test(path), `${folder}/** ⊃ ${path}`);
        assert.ok(compileGlob(`${folder}/**`).test(folder), `${folder}/** ∋ ${folder}`);
    });

    property('* never crosses a "/"', gen => {
        const path = cleanPath(gen, 2);
        assert.ok(!compileGlob(`/${path.split('/', 1)[0] ?? ''}*`).test(path), path);
    });

    const PIECES = [
        '*',
        '**',
        '**/',
        '?',
        'a',
        'b',
        '/',
        '.',
        '{a,b}',
        '{a,{b,}}',
        '[ab]',
        '[!a]',
        '[a-c]',
        '-',
        '}',
        ',',
    ];
    property('the machine and the regular expression read every glob the same way', gen => {
        const pattern = Array.from({ length: 1 + gen.int(6) }, () => gen.pick(PIECES)).join('');
        if (globProblem(pattern) !== undefined) return;
        const machine = compileGlobWith(pattern, 'machine');
        const expression = compileGlobWith(pattern, 'expression');
        for (let index = 0; index < 20; index++) {
            const path = Array.from({ length: 1 + gen.int(8) }, () =>
                gen.pick(['a', 'b', 'c', '/', '.', '-', 'ÿ']),
            ).join('');
            assert.equal(machine.test(path), expression.test(path), `${pattern} on ${path}`);
        }
    });

    it('takes linear time on the inputs that make a backtracking matcher explode', () => {
        const name = `${'a'.repeat(20_000)}b`;
        const started = performance.now();
        for (const pattern of ['*a*a*a*a*a*a*c', '{a,aa}{a,aa}*c', '**/**/**/x']) {
            assert.ok(!compileGlob(pattern).test(name), pattern);
        }
        assert.ok(performance.now() - started < 1000, `${performance.now() - started} ms`);
    });
});

/** Findings as a run gives them: errors in random folders, with random keys and counts. */
function findingsOf(gen: Gen): Finding[] {
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (let index = 0; index < 1 + gen.int(8); index++) {
        const folder = gen.int(4) === 0 ? '.' : cleanPath(gen);
        const rule = gen.pick(['max-files', 'prefix-groups', 'acme/x']);
        const key = rule === 'prefix-groups' ? gen.pick(['render', '__proto__', 'constructor', 'a#b']) : undefined;
        const id = `${folder}\0${rule}#${key ?? ''}`;
        if (seen.has(id)) continue;
        seen.add(id);
        findings.push({
            rule,
            severity: 'error',
            folder,
            message: 'm',
            key,
            measured: 1 + gen.int(40),
            limit: 1,
            files: [],
            moves: [],
            url: undefined,
        });
    }
    return findings;
}

const RULES = new Set(['max-files', 'prefix-groups', 'acme/x']);

describe('suppressions (properties)', () => {
    property('suppressing everything leaves nothing kept and nothing stale', gen => {
        const findings = findingsOf(gen);
        const { suppressions } = addSuppressions([], findings, { fileFor: () => 's.json' });
        const outcome = applySuppressions(findings, suppressions, { folderExists: () => true, rules: RULES });
        assert.deepEqual(outcome.kept, []);
        assert.deepEqual(outcome.stale, []);
        assert.equal(outcome.suppressed.length, findings.length);
    });

    property('suppressing again changes nothing', gen => {
        const findings = findingsOf(gen);
        const first = addSuppressions([], findings, { fileFor: () => 's.json' });
        const second = addSuppressions(first.suppressions, findings, { fileFor: () => 's.json' });
        assert.deepEqual(second.changes, []);
        assert.deepEqual(second.suppressions, first.suppressions);
    });

    property('the file reads back as it was written, from any folder it sits in', gen => {
        const base = gen.pick(['.', 'packages/app']);
        const findings = findingsOf(gen).map(finding => ({
            ...finding,
            folder: base === '.' ? finding.folder : finding.folder === '.' ? base : `${base}/${finding.folder}`,
        }));
        const { suppressions } = addSuppressions([], findings, { fileFor: () => 's.json' });
        const text = serialiseSuppressions(suppressions, base);
        assert.deepEqual(parseSuppressions(JSON.parse(text), { file: 's.json', base }), suppressions);
    });

    property('a count that grows is reported again; one that drops makes the suppression stale', gen => {
        const findings = findingsOf(gen);
        const { suppressions } = addSuppressions([], findings, { fileFor: () => 's.json' });
        const [first, ...rest] = findings;
        if (!first) return;
        const delta = gen.int(2) === 0 ? 1 : -1;
        if (first.measured + delta < 1) return;
        const changed = [{ ...first, measured: first.measured + delta }, ...rest];
        const outcome = applySuppressions(changed, suppressions, { folderExists: () => true, rules: RULES });
        if (delta > 0) {
            assert.deepEqual(
                outcome.kept.map(finding => finding.folder),
                [first.folder],
            );
            assert.deepEqual(outcome.stale, []);
        } else {
            assert.deepEqual(outcome.kept, []);
            assert.deepEqual(
                outcome.stale.map(stale => stale.status),
                ['lowered'],
            );
        }
    });
});
