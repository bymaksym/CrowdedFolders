import type { OverrideState } from './config/types.ts';
import type { Finding } from './findings.ts';
import type { Glob } from './paths/glob.ts';

/** An override with its globs compiled, and whether any folder used it. */
export interface CompiledOverride {
    readonly state: OverrideState;
    readonly globs: readonly Glob[];
    readonly withFiles: readonly Glob[];
    readonly within: readonly Glob[];
    used: boolean;
}

/**
 * The overrides that can match a folder, without trying each: a glob that spells out its folders
 * (`packages/a/**`) is filed under them, one that starts with `**\/name` under that name, and only
 * the rest (`*\/src`, `**`) is tried everywhere. A monorepo with an override per package then costs
 * about the same with 4 000 overrides as with 100. When many globs share their folders
 * (`packages/*\/src/x1/**`, `packages/*\/src/x2/**`), each is filed instead under the plain name after
 * the wildcard that fewest globs hold (`x1`): 400 of them over 200 000 paths took 75 s, all tried under
 * `packages`. The candidates come back in the configuration's order, which is the order they apply in.
 */
export class OverrideIndex {
    private readonly byPrefix = new Map<string, number[]>();
    private readonly bySegment = new Map<string, number[]>();
    private readonly everywhere: number[] = [];
    private readonly overrides: readonly CompiledOverride[];

    constructor(overrides: readonly CompiledOverride[]) {
        this.overrides = overrides;
        const file = (map: Map<string, number[]>, key: string, index: number): void => {
            const list = map.get(key) ?? [];
            if (list.at(-1) !== index) {
                list.push(index);
            }
            map.set(key, list);
        };
        const globs = overrides.flatMap(override => override.globs);
        const prefixes = countOf(globs.map(glob => glob.prefix));
        const names = countOf(globs.flatMap(glob => [...new Set(glob.required)]));
        for (const [index, override] of overrides.entries()) {
            for (const glob of override.globs) {
                const shared = glob.prefix === '' ? Infinity : (prefixes.get(glob.prefix) ?? 0);
                const rarest = glob.required.toSorted((a, b) => (names.get(a) ?? 0) - (names.get(b) ?? 0))[0];
                if (rarest !== undefined && (names.get(rarest) ?? 0) < shared) {
                    file(this.bySegment, rarest, index);
                } else if (glob.prefix !== '') {
                    file(this.byPrefix, glob.prefix, index);
                } else if (glob.segment === undefined) {
                    if (this.everywhere.at(-1) !== index) this.everywhere.push(index);
                } else {
                    file(this.bySegment, glob.segment, index);
                }
            }
        }
    }

    candidatesFor(path: string): CompiledOverride[] {
        const found = new Set<number>(this.everywhere);
        const segments = path.split('/');
        let prefix = '';
        for (const segment of segments) {
            prefix = prefix === '' ? segment : `${prefix}/${segment}`;
            for (const index of this.byPrefix.get(prefix) ?? []) found.add(index);
            for (const index of this.bySegment.get(segment) ?? []) found.add(index);
        }
        return [...found].toSorted((a, b) => a - b).flatMap(index => this.overrides[index] ?? []);
    }
}

function countOf(keys: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const key of keys) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

/** The overrides of the user's own files that matched no folder. */
export function unusedOverrideFindings(overrides: readonly CompiledOverride[]): Finding[] {
    return overrides
        .filter(override => override.state.own && !override.used)
        .map(override => ({
            rule: 'config/unused-override',
            severity: 'warn' as const,
            folder: '.',
            message: `The override for ${override.state.folders.map(glob => `"${glob}"`).join(', ')} in ${override.state.origin} matches no folder ("${override.state.reason}"): remove it, or fix its globs.`,
            key: override.state.folders.join(','),
            measured: 1,
            limit: 0,
            files: [],
            moves: [],
            url: undefined,
        }));
}

/**
 * The overrides of the user's own files whose `expires` is before `today`. They still apply (a
 * date must not turn a build red on its own), and say they are due: renew the date, or remove them.
 */
export function expiredOverrideFindings(
    overrides: readonly CompiledOverride[],
    today: string,
    wholeTree: boolean,
): Finding[] {
    return overrides
        .filter(
            override =>
                override.state.own &&
                override.state.expires !== undefined &&
                override.state.expires < today &&
                (wholeTree || override.used),
        )
        .map(({ state }) => {
            const who = [
                state.owner === undefined ? undefined : `owner ${state.owner}`,
                state.ticket === undefined ? undefined : `ticket ${state.ticket}`,
            ].filter(part => part !== undefined);
            return {
                rule: 'config/expired-override',
                severity: 'warn' as const,
                folder: '.',
                message: `The override for ${state.folders.map(glob => `"${glob}"`).join(', ')} in ${state.origin} expired on ${state.expires ?? ''}${who.length > 0 ? ` (${who.join(', ')})` : ''}: "${state.reason}". It still applies: review it, then renew "expires" or remove it.`,
                key: state.folders.join(','),
                measured: 1,
                limit: 0,
                files: [],
                moves: [],
                url: undefined,
            };
        });
}

/** Today, as `expires` writes a date. */
export function todayInUtc(): string {
    return new Date().toISOString().slice(0, 10);
}
