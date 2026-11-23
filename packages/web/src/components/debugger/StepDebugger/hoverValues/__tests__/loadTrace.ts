import { computeStackHeights, stackEffect } from "../stackHeights";
import { walkStackScopes, type ScopeLoc, type ScopePcMap, type ScopeStep, type StackScope } from "../stackScopes";
import { stackValueAt, type StackValueInput } from "../stackValueAt";
import type { HoverValue } from "../types";

/** The compact trace format of src/__tests__/fixtures/hoverValues/*.json. */
export interface RawTrace {
  meta: Record<string, unknown>;
  ops: string[];
  /** Three numbers for each step: pc, index into ops, depth. */
  steps: number[];
  /** The word each step pushes, without "0x". Empty when it pushes nothing, or for DUP and SWAP. */
  pushed: string[];
  /** The real stack length before each step, from the struct logger. */
  stackLens: number[];
  frames: Array<{ addr: string; entry: number; end: number; depth: number; input: string }>;
  files: string[];
  snippets: string[];
  /** Per address and pc: 0 for no mapping, else [file, line, column, endLine, endColumn, snippet, jumpType]. */
  pcMaps: Record<string, Record<string, unknown>>;
  /** Real memory at a few steps. */
  memory: Record<string, string[]>;
  /** Real stacks at a few steps, to prove that the rebuilt stacks are right. */
  checkpoints: Record<string, string[]>;
}

export interface LoadedTrace {
  meta: Record<string, unknown>;
  steps: ScopeStep[];
  realHeights: number[];
  /** The stack before each step. Index 0 is the bottom. */
  stacks: string[][];
  frames: RawTrace["frames"];
  pcMaps: Record<string, ScopePcMap>;
  memory: Record<number, string[]>;
  checkpoints: Record<number, string[]>;
}

/**
 * Expand a fixture. The fixture holds only the word each opcode pushes, so
 * this function replays the opcodes to rebuild the full stack of each step.
 */
export function loadTrace(raw: RawTrace): LoadedTrace {
  const steps: ScopeStep[] = [];
  for (let i = 0; i < raw.steps.length; i += 3) {
    steps.push({ pc: raw.steps[i]!, op: raw.ops[raw.steps[i + 1]!]!, depth: raw.steps[i + 2]! });
  }
  const current: Record<number, string[]> = {};
  const stacks: string[][] = [];
  steps.forEach((step, i) => {
    const prev = steps[i - 1];
    if (prev) {
      const stack = current[prev.depth]!;
      const effect = stackEffect(prev.op)!;
      if (prev.op.startsWith("DUP")) stack.push(stack[stack.length - effect.pops]!);
      else if (prev.op.startsWith("SWAP")) {
        const a = stack.length - 1;
        const b = stack.length - effect.pops;
        [stack[a], stack[b]] = [stack[b]!, stack[a]!];
      } else {
        stack.length -= effect.pops;
        if (effect.pushes > 0) stack.push("0x" + raw.pushed[i - 1]!);
      }
    }
    if (!prev || step.depth > prev.depth) current[step.depth] = [];
    stacks.push(current[step.depth]!.slice());
  });
  const pcMaps: Record<string, ScopePcMap> = {};
  for (const [addr, byPc] of Object.entries(raw.pcMaps)) {
    const map: ScopePcMap = {};
    for (const [pc, entry] of Object.entries(byPc)) {
      if (!Array.isArray(entry)) {
        map[Number(pc)] = null;
        continue;
      }
      const [file, line, column, endLine, endColumn, snippet, jumpType] = entry as [number, number, number, number, number, number, string];
      const loc: ScopeLoc = { file: raw.files[file]!, line, column, endLine, endColumn, sourceSnippet: raw.snippets[snippet]!, jumpType };
      map[Number(pc)] = loc;
    }
    pcMaps[addr] = map;
  }
  const numeric = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));
  return {
    meta: raw.meta,
    steps,
    realHeights: raw.stackLens,
    stacks,
    frames: raw.frames,
    pcMaps,
    memory: numeric(raw.memory),
    checkpoints: numeric(raw.checkpoints),
  };
}

/** Position of the nth whole-word use of `word` in the snippet of `loc`: 1-based line, 0-based column. */
export function positionOf(loc: ScopeLoc, word: string, nth = 0): { file: string; line: number; col: number } {
  const re = new RegExp("(?<![\\w$])" + word.replace(/[$]/g, "\\$") + "(?![\\w$])", "g");
  let m: RegExpExecArray | null = null;
  for (let k = 0; k <= nth; k++) {
    m = re.exec(loc.sourceSnippet);
    if (!m) throw new Error(`no use ${nth} of ${word}`);
  }
  const before = loc.sourceSnippet.slice(0, m!.index);
  const lines = before.split("\n");
  const line = loc.line + lines.length - 1;
  const col = lines.length === 1 ? loc.column - 1 + before.length : lines[lines.length - 1]!.length;
  return { file: loc.file, line, col };
}

export interface Probe {
  trace: LoadedTrace;
  heights: Int32Array;
}

export function probeOf(raw: unknown): Probe {
  const trace = loadTrace(raw as RawTrace);
  return { trace, heights: computeStackHeights(trace.steps) };
}

type Frame = LoadedTrace["frames"][number];

/** The frame at `index` in call order. */
export function frameOf(p: Probe, index = 0): Frame {
  return p.trace.frames[index]!;
}

/** Entry steps (the JUMPDEST) of each call of function `name` in a frame, in order. */
export function entriesOf(p: Probe, frame: Frame, name: string): number[] {
  const { steps, pcMaps } = p.trace;
  const pcMap = pcMaps[frame.addr] ?? {};
  const out: number[] = [];
  for (let i = frame.entry; i < frame.end - 1; i++) {
    const step = steps[i]!;
    if (step.depth !== frame.depth || step.op !== "JUMP" || pcMap[step.pc]?.jumpType !== "i") continue;
    const landing = pcMap[steps[i + 1]!.pc];
    if (landing && new RegExp("^\\s*function\\s+" + name + "\\s*\\(").test(landing.sourceSnippet)) out.push(i + 1);
  }
  return out;
}

/** The scopes open at `step`, outermost first. */
export function scopesAt(p: Probe, step: number): StackScope[] {
  const { steps, frames, pcMaps } = p.trace;
  const frame = [...frames].reverse().find((f) => f.entry <= step && step < f.end && steps[step]!.depth === f.depth)!;
  return walkStackScopes(steps, p.heights, frame, pcMaps[frame.addr] ?? {}, step)?.scopes ?? [];
}

/**
 * Hover `word` in the source of function `fnName` while the cursor is at
 * `step`. The pointer is on use number `use` of the word in that function.
 */
export function hover(
  p: Probe,
  step: number,
  fnName: string,
  word: string,
  extra: Partial<StackValueInput> & { use?: number; locAddr?: string } = {},
): HoverValue | null {
  const { use = 0, locAddr, ...rest } = extra;
  const { steps, frames } = p.trace;
  const frame = [...frames].reverse().find((f) => f.entry <= step && step < f.end && steps[step]!.depth === f.depth)!;
  const loc = locOf(p, fnName, locAddr ?? frame.addr);
  return stackValueAt({
    word,
    ...positionOf(loc, word, use),
    steps: p.trace.steps,
    heights: p.heights,
    frames: p.trace.frames,
    currentStep: step,
    traceSourceMaps: p.trace.pcMaps,
    detail: { stack: p.trace.stacks[step]!, memory: p.trace.memory[step] ?? null },
    ...rest,
  });
}

const locCache = new WeakMap<Probe, Map<string, ScopeLoc>>();

/** The source location of the definition of function `fnName` in the source map of `addr`. */
export function locOf(p: Probe, fnName: string, addr: string): ScopeLoc {
  let cache = locCache.get(p);
  if (!cache) locCache.set(p, (cache = new Map()));
  const key = addr + ":" + fnName;
  let loc = cache.get(key);
  if (!loc) cache.set(key, (loc = findLoc(p, fnName, addr)));
  return loc;
}

function findLoc(p: Probe, fnName: string, addr: string): ScopeLoc {
  const head = new RegExp("^\\s*function\\s+" + fnName + "\\s*\\(");
  let best: ScopeLoc | null = null;
  for (const loc of Object.values(p.trace.pcMaps[addr] ?? {})) {
    if (loc && head.test(loc.sourceSnippet) && loc.sourceSnippet.length > (best?.sourceSnippet.length ?? 0)) best = loc;
  }
  if (!best) throw new Error("no function " + fnName);
  return best;
}
