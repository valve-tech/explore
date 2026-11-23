import type { SolIndex } from "./solIndex";
import type { GotoContext } from "./planGoto";

export interface ExecutedCall {
  file: string;
  line: number;
  /** The step where the executed function starts in this frame. */
  step: number;
}

/**
 * Where an internal call ACTUALLY ran. Walk the active frame forward from the
 * step of the clicked call line and return the first step that lands on a
 * declaration of `name`. The trace knows which override ran, so this beats
 * the static inheritance ranking whenever the line executed.
 *
 * Only steps at the frame's own depth count: a deeper step belongs to another
 * contract, and its program counter means nothing in this frame's source map.
 */
export function executedCallTarget(
  index: SolIndex,
  steps: ReadonlyArray<{ pc: number; depth: number }>,
  frame: { entry: number; end: number } | null,
  pcMap: GotoContext["pcMap"],
  fromStep: number | undefined,
  name: string,
): ExecutedCall | null {
  if (!frame || !pcMap || fromStep === undefined || fromStep < frame.entry) return null;
  const depth = steps[frame.entry]?.depth;
  const decl = new RegExp("\\b(?:function|modifier)\\s+" + name.replace(/[$]/g, "\\$") + "\\b");
  const from = pcMap[steps[fromStep]?.pc ?? -1];
  for (let j = fromStep + 1; j < frame.end; j++) {
    const s = steps[j]!;
    if (s.depth !== depth) continue;
    const loc = pcMap[s.pc];
    if (!loc || (from && loc.file === from.file && loc.line === from.line)) continue;
    const pf = index.files.get(loc.file);
    const start = pf?.lineStarts[loc.line - 1];
    if (!pf || start === undefined) continue;
    const text = pf.text.slice(start, pf.lineStarts[loc.line] ?? pf.text.length);
    if (decl.test(text)) return { file: loc.file, line: loc.line, step: j };
  }
  return null;
}
