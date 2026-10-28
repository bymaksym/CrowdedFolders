/**
 * The candidate closest to what was typed, for "did you mean …?": the same ignoring case, else at
 * most two edits away (a swap of two neighbours is one edit: `explian` is one from `explain`).
 * `undefined` when nothing is that close, so that a suggestion is never a wild guess.
 */
export function closest(typed: string, candidates: Iterable<string>): string | undefined {
    const lower = typed.toLowerCase();
    let best: string | undefined;
    let bestDistance = Math.min(2, Math.floor(typed.length / 3));
    for (const candidate of candidates) {
        const other = candidate.toLowerCase();
        if (other === lower) {
            return candidate;
        }
        if (Math.abs(other.length - lower.length) > bestDistance) {
            continue;
        }
        const distance = editDistance(lower, other);
        // The first candidate within reach, then only a closer one.
        if (distance > bestDistance || (best !== undefined && distance === bestDistance)) {
            continue;
        }
        best = candidate;
        bestDistance = distance;
    }
    return best;
}

/** Insertions, deletions, substitutions and swaps of neighbours (optimal string alignment). */
export function editDistance(a: string, b: string): number {
    const rows = a.length + 1;
    const columns = b.length + 1;
    const table = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
    );
    for (let row = 1; row < rows; row++) {
        for (let column = 1; column < columns; column++) {
            const cost = a[row - 1] === b[column - 1] ? 0 : 1;
            const at = (r: number, c: number): number => table[r]?.[c] ?? 0;
            let value = Math.min(at(row - 1, column) + 1, at(row, column - 1) + 1, at(row - 1, column - 1) + cost);
            if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
                value = Math.min(value, at(row - 2, column - 2) + 1);
            }
            const line = table[row];
            if (line) {
                line[column] = value;
            }
        }
    }
    return table[a.length]?.[b.length] ?? 0;
}
