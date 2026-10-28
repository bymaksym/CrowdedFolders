import { compareText, type Module } from './naming/modules.ts';
import { type Mirror, mirrorOf, sourceOf } from './paths/mirrors.ts';
import { baseName, type FolderEntry, parentOf } from './paths/tree.ts';
import { caseless, planMoves } from './rules/moves.ts';
import type { FolderView, Move, RuleContext } from './rules/rule.ts';

/** What folding the mirrors needs from the engine. */
export interface MirrorTree {
    readonly folder: (path: string) => FolderEntry | undefined;
    readonly viewOf: (entry: FolderEntry) => FolderView;
    readonly existing: NonNullable<RuleContext<object>['existing']>;
}

/** A finding as far as mirrors are concerned. */
interface Foldable {
    readonly rule: string;
    readonly folder: string;
    readonly key: string | undefined;
    readonly message: string;
    readonly moves: readonly Move[];
}

/**
 * Folds each tree that mirrors another (`naming.mirrors`) into its source: the problem the mirror
 * has too (same rule, same key) is reported once, in the source, and the source's moves take the
 * mirror's files of the same modules along — `src/test/java/…/RenderJsonTest.java` goes where
 * `src/main/java/…/RenderJson.java` goes. Two findings for one decision are two suppressions, and
 * a move of half the tree breaks the other half.
 */
export function foldMirrors<T extends Foldable>(findings: readonly T[], tree: MirrorTree): T[] {
    const byFolder = new Map<string, T[]>();
    for (const finding of findings) {
        const list = byFolder.get(finding.folder);
        if (list) {
            list.push(finding);
        } else {
            byFolder.set(finding.folder, [finding]);
        }
    }
    const folded = new Set<T>();
    const changed = new Map<T, T>();
    for (const [path, own] of byFolder) {
        const entry = tree.folder(path);
        if (!entry) {
            continue;
        }
        const view = tree.viewOf(entry);
        for (const mirror of view.naming.mirrors ?? []) {
            const mirrorPath = mirrorOf(path, mirror);
            const mirrorEntry = mirrorPath === undefined || mirrorPath === path ? undefined : tree.folder(mirrorPath);
            if (mirrorPath === undefined || !mirrorEntry) {
                continue;
            }
            const twins = byFolder.get(mirrorPath) ?? [];
            for (const finding of own) {
                if (folded.has(finding)) {
                    continue;
                }
                const twin = twins.find(other => other.rule === finding.rule && other.key === finding.key);
                if (twin) {
                    folded.add(twin);
                }
                const current = changed.get(finding) ?? finding;
                const extra = mirroredMoves(current.moves, view, tree.viewOf(mirrorEntry), mirror, tree.existing);
                if (twin === undefined && extra.moves.length === 0) {
                    continue;
                }
                changed.set(finding, {
                    ...current,
                    message: `${current.message} Its mirror ${mirrorPath}/ goes with it.${extra.notes.map(note => ` ${note}`).join('')}`,
                    moves: [...current.moves, ...extra.moves],
                });
            }
        }
    }
    return findings.filter(finding => !folded.has(finding)).map(finding => changed.get(finding) ?? finding);
}

/** The moves of the mirror's files that go with `moves`, and what could not move. */
function mirroredMoves(
    moves: readonly Move[],
    source: FolderView,
    mirror: FolderView,
    pair: Mirror,
    existing: MirrorTree['existing'],
): { readonly moves: Move[]; readonly notes: string[] } {
    const twins = new Map(mirror.modules.map(module => [caseless(module.stem), module] as const));
    // Each moved module of the source once: its new stem and its new folder.
    const plans = new Map<
        string,
        { readonly dir: string; readonly modules: Module[]; readonly stems: Map<Module, string> }
    >();
    const seen = new Set<Module>();
    for (const move of moves) {
        if (parentOf(move.from) !== source.path) {
            continue;
        }
        const name = baseName(move.from);
        const module = source.modules.find(candidate => candidate.files.includes(name));
        const twin = module && twins.get(caseless(module.stem));
        if (!module || !twin || seen.has(module)) {
            continue;
        }
        seen.add(module);
        const dir = parentOf(move.to);
        const mirrorDir =
            mirrorOf(dir, pair) ??
            (dir.startsWith(`${source.path}/`) ? `${mirror.path}${dir.slice(source.path.length)}` : mirror.path);
        const plan = plans.get(mirrorDir) ?? {
            dir: mirrorDir,
            modules: [] as Module[],
            stems: new Map<Module, string>(),
        };
        plan.modules.push(twin);
        plan.stems.set(twin, newStem(name, baseName(move.to), module.stem) ?? twin.stem);
        plans.set(mirrorDir, plan);
    }
    const result: { moves: Move[]; notes: string[] } = { moves: [], notes: [] };
    for (const plan of [...plans.values()].toSorted((a, b) => compareText(a.dir, b.dir))) {
        const planned = planMoves(
            plan.modules,
            mirror.path,
            plan.dir,
            (file, module) => replaceStem(file, module.stem, plan.stems.get(module) ?? module.stem),
            existing,
        );
        result.moves.push(...planned.moves);
        result.notes.push(...planned.notes);
    }
    return result;
}

/** What `stem` became when `from` was renamed `to`: `json` for `render-json.ts` → `json.ts`. */
function newStem(from: string, to: string, stem: string): string | undefined {
    const at = from.indexOf(stem);
    if (at === -1) {
        return undefined;
    }
    const before = from.slice(0, at);
    const after = from.slice(at + stem.length);
    const fits = to.startsWith(before) && to.endsWith(after) && to.length >= before.length + after.length;
    return fits ? to.slice(before.length, to.length - after.length) : undefined;
}

/** A file name with its module's stem written anew: `RenderJsonTest.java` → `JsonTest.java`. */
function replaceStem(file: string, stem: string, renamed: string): string | undefined {
    if (stem === renamed) {
        return undefined;
    }
    const at = file.indexOf(stem);
    const found =
        at === -1 && file.toLowerCase().length === file.length ? file.toLowerCase().indexOf(stem.toLowerCase()) : at;
    return found === -1 ? undefined : `${file.slice(0, found)}${renamed}${file.slice(found + stem.length)}`;
}

/** The folders on the other side of each mirror from `path`: its mirror, and the folder it mirrors. */
export function counterpartsOf(path: string, mirrors: readonly Mirror[]): string[] {
    return mirrors
        .flatMap(mirror => [mirrorOf(path, mirror), sourceOf(path, mirror)])
        .filter((other): other is string => other !== undefined && other !== path);
}
