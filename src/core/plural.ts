/** `1 file`, `2 files`, `1,200 files`: a count with its noun, in the form that agrees with it. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/**
 * How many of `total` to show when a list is cut at `max`: all of them when only one would be left out,
 * since "and 1 more" takes as much room as the name it hides.
 */
export function shownOf(total: number, max: number): number {
    return total <= max + 1 ? total : max;
}
