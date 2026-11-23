import type { SourceFile } from "../../../../api/source";
import type { FrameRange } from "../lineToStepIndex";
import type { ClickModifier, NavTarget } from "./resolveClick";

/** Plain, ⌘/Ctrl (meta) or ⌥/Alt. Alt wins when both are down. */
export function clickModifierOf(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ClickModifier {
  if (e.altKey) return "alt";
  return e.metaKey || e.ctrlKey ? "meta" : "plain";
}

export interface GotoPlan {
  line: number;
  /** Contract + file to display when it is not the cursor's own file. */
  ref: { addr: string; file: string } | null;
  /** Step to move the cursor to, or null to leave the cursor in place. */
  step: number | null;
}

export interface GotoContext {
  /** Contract whose source the pane shows now. */
  displayAddr: string | null;
  /** True when the pane shows a contract that is not the active frame's. */
  viewingOther: boolean;
  /** File the cursor's own step maps to. */
  currentFile: string | null;
  frame: { entry: number; end: number } | null;
  steps: ReadonlyArray<{ pc: number }>;
  /** Source map of the ACTIVE FRAME's contract (traceSourceMaps[frameAddr]). */
  pcMap: Record<number, { file: string; line: number } | null | undefined> | undefined;
}

/**
 * Decide how the pane shows a target. The cursor moves only to a step of the
 * ACTIVE FRAME that maps to the target line, through that frame's own source
 * map. It never scans the whole trace: the same line runs in many frames.
 */
export function planGoto(target: NavTarget, ctx: GotoContext): GotoPlan {
  if (target.addr) return { line: target.line, ref: { addr: target.addr, file: target.file }, step: null };
  if (ctx.viewingOther) {
    return { line: target.line, ref: ctx.displayAddr ? { addr: ctx.displayAddr, file: target.file } : null, step: null };
  }
  if (ctx.frame && ctx.pcMap) {
    for (let j = ctx.frame.entry; j < ctx.frame.end; j++) {
      const loc = ctx.pcMap[ctx.steps[j]!.pc];
      if (loc && loc.file === target.file && loc.line === target.line) return { line: target.line, ref: null, step: j };
    }
  }
  const otherFile = target.file !== ctx.currentFile && ctx.displayAddr !== null;
  return { line: target.line, ref: otherFile ? { addr: ctx.displayAddr!, file: target.file } : null, step: null };
}

/**
 * Sources of the next external callee of the active frame at or after
 * `fromStep`: the first direct child frame. A proxy callee lists its
 * implementation first. Contracts without loaded source are left out.
 */
export function calleeSources(
  frameRanges: readonly FrameRange[],
  active: FrameRange | null,
  fromStep: number,
  implByProxy: ReadonlyMap<string, string>,
  sourcesByAddr: Record<string, SourceFile[] | undefined>,
): Array<{ addr: string; files: SourceFile[] }> {
  if (!active) return [];
  let child: FrameRange | null = null;
  for (const f of frameRanges) {
    if (!f.addr || f.depth !== active.depth + 1) continue;
    if (f.entry <= active.entry || f.entry >= active.end || f.entry < fromStep) continue;
    if (!child || f.entry < child.entry) child = f;
  }
  if (!child?.addr) return [];
  const proxy = child.addr.toLowerCase();
  const out: Array<{ addr: string; files: SourceFile[] }> = [];
  for (const addr of new Set([implByProxy.get(proxy), proxy])) {
    const files = addr ? sourcesByAddr[addr] : undefined;
    if (addr && files && files.length > 0) out.push({ addr, files });
  }
  return out;
}
