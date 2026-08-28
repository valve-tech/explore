/**
 * Turns the flat internal-call list back into a tree for rendering.
 *
 * The API sends the calls depth-first in execution order, each carrying the
 * depth it sat at. That pair is a lossless encoding of the tree: a row's
 * parent is the nearest earlier row with a smaller depth. Rebuilding it here
 * keeps the wire shape flat, so nothing that already reads the list breaks.
 *
 * The output stays a flat list too — one entry per call, in the same order —
 * carrying only the guide marks a renderer needs. A nested structure would
 * force the component to recurse, and a long trace is better rendered as rows.
 */

export interface CallDepth {
  /** 1 for a direct call of the transaction. Absent on a pre-depth cache. */
  depth?: number;
}

export interface TreeRow<T> {
  row: T;
  /** Normalised depth — 1 for a direct call, never below 1. */
  depth: number;
  /**
   * One flag per ancestor level from depth 2 down, oldest first: true when
   * that ancestor has a later sibling, so its guide line continues past this
   * row.
   *
   * Depth 1 is deliberately absent. A direct call of the transaction draws no
   * connector of its own, so a `│` in that column would hang off nothing —
   * measured in the browser, it made a depth-3 row under one top-level call
   * look differently indented from the same row under another.
   */
  guides: boolean[];
  /** True when no later row shares this row's parent. */
  isLast: boolean;
  /** True when a later row is nested inside this one. */
  hasChildren: boolean;
}

/** Depth as the tree uses it: at least 1, and 1 for a row that has none. */
function depthOf(row: CallDepth): number {
  return Math.max(1, row.depth ?? 1);
}

/**
 * True when no row after `i` is a sibling of `rows[i]`.
 *
 * A sibling is the next row at the same depth reached without first leaving
 * the parent — so the scan stops at the first row shallower than this one.
 */
function isLastAtIndex(rows: CallDepth[], i: number): boolean {
  const depth = depthOf(rows[i]!);
  for (let j = i + 1; j < rows.length; j += 1) {
    const other = depthOf(rows[j]!);
    if (other < depth) return true;
    if (other === depth) return false;
  }
  return true;
}

/**
 * Lay the flat list out as a tree.
 *
 * A pre-depth cached response has no depth on any row, which normalises to a
 * single flat level — the old rendering, not a crash.
 */
export function toCallTree<T extends CallDepth>(rows: T[]): TreeRow<T>[] {
  // `continues[d]` answers "does the guide line at depth d still run?" — it is
  // the last-child flag of the ancestor currently open at that depth.
  const continues: boolean[] = [];

  return rows.map((row, i) => {
    const depth = depthOf(row);
    const isLast = isLastAtIndex(rows, i);
    continues[depth] = !isLast;
    continues.length = depth + 1;

    const guides: boolean[] = [];
    for (let d = 2; d < depth; d += 1) guides.push(continues[d] ?? false);

    const next = rows[i + 1];
    return {
      row,
      depth,
      guides,
      isLast,
      hasChildren: next !== undefined && depthOf(next) > depth,
    };
  });
}
