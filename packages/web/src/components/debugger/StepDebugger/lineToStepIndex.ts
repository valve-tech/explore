/**
 * Frame-scoped source-line → step index, used by the debugger's source-gutter
 * click handler (`jumpToLine` in StepDebugger.tsx).
 *
 * The bug this replaces: the old memo scanned EVERY step in the whole trace
 * against a SINGLE source map (the active contract's), and recorded the
 * globally-first step for each line. Two problems fell out of that:
 *
 *   1. PCs are per-contract. When a trace touches multiple contracts (or the
 *      same contract re-entered at a different frame), applying one
 *      contract's map to steps that actually belong to a DIFFERENT contract
 *      produces a coincidental (garbage) line number — same pc, unrelated
 *      source line.
 *   2. Even within a single contract, "globally first step for this line"
 *      ignores which invocation the user is currently inspecting. Clicking a
 *      line inside a loop body (or a function called more than once) always
 *      teleported back to iteration 1 / the first call, not the current one.
 *
 * The fix mirrors `jumpToDefinition`'s proven pattern elsewhere in
 * StepDebugger.tsx: resolve the CURRENT FRAME (the deepest frameRanges entry
 * covering the cursor), use THAT frame's own per-contract source map, and
 * scan ONLY that frame's step range — so both the executable-line set and the
 * jump target are scoped to the execution context the user is looking at.
 */

export interface FrameRange {
  addr: string | null;
  entry: number;
  end: number;
  depth: number;
}

// A structural subset of api/source's SourceLocation — deliberately no index
// signature, so the real (richer) SourceLocation values assign in without a
// TS "index signature is missing" complaint while still keeping this module
// decoupled from the concrete api/source type.
export interface SourceLoc {
  file: string;
  line: number;
}

// `| null` (not just `| undefined`) matches the real shape produced by
// useSourceMappings / useTraceSourceMaps — PC entries with no mapping are
// stored as `null`, not omitted.
export type PcSourceMap = Record<number, SourceLoc | null | undefined>;

export interface StepLike {
  pc: number;
}

/**
 * The deepest frame whose [entry, end) range covers `step`. Null when no
 * frame covers it (e.g. an empty `frames` array, or a step outside every
 * range — shouldn't happen in practice but the caller shouldn't crash on it).
 *
 * Replicates the exact "deepest depth wins" scan used by
 * `activeContractAddress` / `jumpToDefinition` / `hasNext` / `jumpToNext`.
 */
export function activeFrame(frames: FrameRange[], step: number): FrameRange | null {
  let best: FrameRange | null = null;
  let bestDepth = -1;
  for (const f of frames) {
    if (f.entry <= step && step < f.end && f.depth > bestDepth) {
      bestDepth = f.depth;
      best = f;
    }
  }
  return best;
}

/**
 * Build the executable-line set + line→firstStep map for a SINGLE execution
 * context — the current frame — using that frame's own contract source map.
 * Scans ONLY [range.entry, range.end) (or the whole trace when `range` is
 * null, preserving single-contract/no-frame behavior), so line clicks land in
 * the context the user is inspecting instead of the globally-first
 * occurrence, and cross-contract PC collisions can't mis-map.
 */
export function buildFrameLineIndex(
  steps: StepLike[],
  range: { entry: number; end: number } | null,
  pcMap: PcSourceMap | undefined,
  file: string | null,
): { executableLines: Set<number>; lineToStep: Map<number, number> } {
  const executableLines = new Set<number>();
  const lineToStep = new Map<number, number>();
  if (!file || !pcMap) return { executableLines, lineToStep };

  const start = range?.entry ?? 0;
  const end = range?.end ?? steps.length;
  for (let j = start; j < end; j++) {
    const loc = pcMap[steps[j]!.pc];
    if (loc && loc.file === file) {
      executableLines.add(loc.line);
      if (!lineToStep.has(loc.line)) lineToStep.set(loc.line, j);
    }
  }
  return { executableLines, lineToStep };
}
