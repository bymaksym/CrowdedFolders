/**
 * The layout of the treemap: which rectangle each folder gets. Pure arithmetic, so it is tested without a
 * browser - and the same two functions are copied, as text, into the HTML report (`html.ts`), so that the
 * page lays itself out again when the window changes size or a folder is zoomed into, with the code that
 * is tested here and no second implementation.
 *
 * That is the one rule of this file: `squarify` and `layoutTreemap` use nothing outside themselves and each
 * other (no import, no constant, no other function of the module), and a test runs the two, as text, in an
 * empty context to prove it. They are `function` declarations because a declaration keeps its name when it is
 * turned into text.
 */

export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000): rows of rectangles along the shorter side of
 * what is left, each row grown while its worst aspect ratio gets no worse. The result is parallel to
 * `weights`: item `i` gets the rectangle `i`, and an item of weight 0 an empty one. The areas add up to
 * the area of the rectangle and each is in proportion to its weight.
 */
export function squarify(weights: readonly number[], x: number, y: number, w: number, h: number): Rect[] {
    const out: Rect[] = [];
    const order: number[] = [];
    let total = 0;
    for (const [i, weight] of weights.entries()) {
        out.push({ x, y, w: 0, h: 0 });
        if (!(weight > 0)) {
            continue;
        }

        total += weight;
        order.push(i);
    }
    if (total <= 0 || w <= 0 || h <= 0) {
        return out;
    }
    // Biggest first, ties in their own order, so the same input always gives the same picture.
    order.sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a - b);
    const scale = (w * h) / total;
    let left = x;
    let top = y;
    let width = w;
    let height = h;
    let start = 0;
    while (start < order.length) {
        const side = Math.min(width, height);
        let sum = 0;
        let end = start;
        let worst = Infinity;
        while (end < order.length) {
            const area = (weights[order[end] ?? 0] ?? 0) * scale;
            const nextSum = sum + area;
            const biggest = (weights[order[start] ?? 0] ?? 0) * scale;
            const nextWorst = Math.max(
                (side * side * biggest) / (nextSum * nextSum),
                (nextSum * nextSum) / (side * side * area),
            );
            if (end > start && nextWorst > worst) {
                break;
            }
            sum = nextSum;
            worst = nextWorst;
            end++;
        }
        // The row is a strip across the shorter side: its thickness is its area over that side.
        const last = end >= order.length;
        const wide = width >= height;
        const thickness = last ? (wide ? width : height) : sum / side;
        let offset = 0;
        for (let k = start; k < end; k++) {
            const index = order[k] ?? 0;
            const area = (weights[index] ?? 0) * scale;
            const length = k === end - 1 ? side - offset : area / thickness;
            out[index] = wide
                ? { x: left, y: top + offset, w: thickness, h: length }
                : { x: left + offset, y: top, w: length, h: thickness };
            offset += length;
        }
        if (wide) {
            left += thickness;
            width -= thickness;
        } else {
            top += thickness;
            height -= thickness;
        }
        start = end;
    }
    return out;
}

/** What the layout needs of a folder: its weight (itself and below), and its own weight when it has folders below. */
export interface TreemapNode {
    /** The area it asks for: its own modules plus those of every folder below. */
    readonly w: number;
    /** Its own modules: what is left for a folder that also has folders below. */
    readonly s: number;
    readonly c?: readonly TreemapNode[] | undefined;
}

export interface TreemapOptions {
    /** How many levels below the root are drawn at most (1: only its children). */
    readonly depth: number;
    /** The height of the strip that names a folder drawn with its children inside. */
    readonly header: number;
    /** The space between a folder's frame and what it holds, and between neighbours. */
    readonly gap: number;
    /** A folder is drawn open (children inside) only when it is at least this wide and this tall (header included). */
    readonly openWidth: number;
    readonly openHeight: number;
    /** At most this many rectangles per folder; the smallest are drawn as one, `rest`. */
    readonly most: number;
}

/** One rectangle of the picture, in the order it must be drawn (a frame before what is inside it). */
export interface Cell extends Rect {
    readonly node: TreemapNode;
    readonly parent: TreemapNode | undefined;
    /** 1 for a child of the root. */
    readonly depth: number;
    /** Drawn open: its children are inside it, below its header. */
    readonly open: boolean;
    /** The files of `parent` itself, drawn as a cell of their own beside its folders. */
    readonly self: boolean;
    /** The smallest children of `parent` that were drawn as this one cell, when there were too many. */
    readonly rest?: readonly TreemapNode[] | undefined;
}

/**
 * Lays out the children of `root` (and, while there is room, theirs) in a rectangle. A folder with files of
 * its own and folders below gets a cell for its files beside the cells of its folders, so that a junk drawer
 * with three small folders in it is still drawn as one.
 */
export function layoutTreemap(root: TreemapNode, rect: Rect, options: TreemapOptions): Cell[] {
    const cells: Cell[] = [];
    const fill = (node: TreemapNode, x: number, y: number, w: number, h: number, depth: number): void => {
        const items: { node: TreemapNode; self: boolean; rest?: TreemapNode[] }[] = Array.from(node.c ?? [], child => ({
            node: child,
            self: false,
        }));
        if (items.length > 0 && node.s > 0) {
            items.push({ node, self: true });
        }
        items.sort((a, b) => (b.self ? b.node.s : b.node.w) - (a.self ? a.node.s : a.node.w));
        if (items.length > options.most) {
            const kept = items.slice(0, options.most - 1);
            const rest = items.slice(options.most - 1);
            let weight = 0;
            for (const item of rest) {
                weight += item.self ? item.node.s : item.node.w;
            }
            // The cell for many small ones has no node of its own: a node that weighs what they weigh.
            kept.push({ node: { w: weight, s: 0 }, self: false, rest: rest.map(item => item.node) });
            items.length = 0;
            items.push(...kept);
        }
        const weights = items.map(item => (item.self ? item.node.s : item.node.w));
        const rects = squarify(weights, x, y, w, h);
        for (const [index, item] of items.entries()) {
            const at = rects[index] ?? { x, y, w: 0, h: 0 };
            if (at.w <= 0 || at.h <= 0) {
                continue;
            }
            const children = item.self || item.rest ? undefined : item.node.c;
            const open =
                depth < options.depth &&
                children !== undefined &&
                children.length > 0 &&
                at.w >= options.openWidth &&
                at.h >= options.openHeight;
            cells.push({
                x: at.x,
                y: at.y,
                w: at.w,
                h: at.h,
                node: item.node,
                parent: node,
                depth,
                open,
                self: item.self,
                ...(item.rest && { rest: item.rest }),
            });
            if (!open) {
                continue;
            }
            const inner = options.gap;
            fill(
                item.node,
                at.x + inner,
                at.y + options.header,
                Math.max(0, at.w - 2 * inner),
                Math.max(0, at.h - options.header - inner),
                depth + 1,
            );
        }
    };
    fill(root, rect.x, rect.y, rect.w, rect.h, 1);
    return cells;
}
