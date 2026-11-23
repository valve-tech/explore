import { parseFunctionSignature, type FunctionSignature } from "./functionSignature";
import { stackEffect } from "./stackHeights";

/** The part of a source-map entry this module reads. */
export interface ScopeLoc {
  file: string;
  line: number;
  /** 1-based, as the source-map API sends it. */
  column: number;
  endLine: number;
  endColumn: number;
  sourceSnippet: string;
  jumpType: string;
}

export type ScopePcMap = Record<number, ScopeLoc | null | undefined>;

export interface ScopeStep {
  pc: number;
  op: string;
  depth: number;
}

/** One internal function call that is open at a step. */
export interface StackScope {
  /** The JUMP that enters the function. */
  jumpStep: number;
  /** The JUMPDEST at the start of the function. */
  entryStep: number;
  /** Stack index of the first parameter slot. The return label is at base - 1. */
  base: number;
  fn: FunctionSignature;
  /** Source location of the whole function definition. */
  loc: ScopeLoc;
  /** True when the selector dispatcher entered the function. */
  dispatch: boolean;
}

export interface ScopeWalk {
  /** Open scopes, outermost first. */
  scopes: StackScope[];
  /**
   * True when the walk found a dispatcher entry of the legacy code generator:
   * a JUMP of type 'i' that has the same source range as the function it
   * enters. The IR pipeline maps that JUMP to the contract definition.
   */
  legacyDispatch: boolean;
}

/**
 * The lowest stack index an opcode removes. DUP and SWAP remove nothing: the
 * return sequence of a function swaps the return label, and the scope stays
 * open until the JUMP. Returns null for an unknown opcode.
 */
function lowestPop(op: string, height: number): number | null {
  const effect = stackEffect(op);
  if (!effect) return null;
  return op.startsWith("DUP") || op.startsWith("SWAP") ? height : height - effect.pops;
}

const signatureCache = new Map<string, FunctionSignature | null>();

function signatureOf(snippet: string): FunctionSignature | null {
  let sig = signatureCache.get(snippet);
  if (sig === undefined) {
    sig = /^\s*function\b/.test(snippet) ? parseFunctionSignature(snippet) : null;
    if (signatureCache.size > 2000) signatureCache.clear();
    signatureCache.set(snippet, sig);
  }
  return sig;
}

const sameRange = (a: ScopeLoc, b: ScopeLoc) =>
  a.file === b.file && a.line === b.line && a.column === b.column && a.endLine === b.endLine && a.endColumn === b.endColumn;

const viaIrCache = new WeakMap<object, boolean>();
const CONTRACT_HEAD = /^\s*(?:abstract\s+contract|contract|library|interface)\b/;

/**
 * True when the source map shows the IR pipeline (via-IR). That pipeline maps
 * the jumps of its helper functions to the whole contract definition. The
 * legacy code generator gives those jumps no source location.
 * The stack layout of via-IR code is not the legacy layout, so the caller
 * must not read a variable from the stack.
 */
export function looksViaIr(pcMap: ScopePcMap): boolean {
  let hit = viaIrCache.get(pcMap);
  if (hit === undefined) {
    hit = false;
    for (const key in pcMap) {
      const loc = pcMap[key];
      if (loc && (loc.jumpType === "i" || loc.jumpType === "o") && CONTRACT_HEAD.test(loc.sourceSnippet)) {
        hit = true;
        break;
      }
    }
    viaIrCache.set(pcMap, hit);
  }
  return hit;
}

/**
 * Find the function scopes that are open before step `upTo` in one frame.
 *
 * The walk reads only the steps of the frame at the depth of the frame. A
 * scope opens at a JUMP of type 'i' that lands on a JUMPDEST mapped to a whole
 * function definition. In legacy code the stack at that JUMPDEST is
 * [..., return label, parameter slots]. A scope closes at the JUMP that
 * returns, where the stack is [..., return slots, return label], or when an
 * opcode removes the return label.
 *
 * Returns null when a stack height in the range is unknown.
 */
export function walkStackScopes(
  steps: readonly ScopeStep[],
  heights: Int32Array,
  frame: { entry: number; end: number; depth: number },
  pcMap: ScopePcMap,
  upTo: number,
): ScopeWalk | null {
  const scopes: StackScope[] = [];
  let legacyDispatch = false;
  const stop = Math.min(upTo, frame.end);
  for (let i = frame.entry; i < stop; i++) {
    const step = steps[i]!;
    if (step.depth !== frame.depth) continue;
    const height = heights[i]!;
    if (height < 0) return null;
    const isJump = step.op === "JUMP";
    const loc = isJump ? pcMap[step.pc] : undefined;
    const top = scopes[scopes.length - 1];
    if (isJump && top && loc?.jumpType !== "i" && height === top.base + top.fn.returnSlots) scopes.pop();
    const low = lowestPop(step.op, height);
    if (low === null) continue;
    while (scopes.length > 0 && low < scopes[scopes.length - 1]!.base) scopes.pop();

    if (!isJump || loc?.jumpType !== "i") continue;
    const landing = steps[i + 1];
    if (i + 1 >= frame.end || !landing || landing.depth !== frame.depth || landing.op !== "JUMPDEST") continue;
    const landingLoc = pcMap[landing.pc];
    const fn = landingLoc ? signatureOf(landingLoc.sourceSnippet) : null;
    if (!landingLoc || !fn) continue;
    const base = heights[i + 1]! - fn.paramSlots;
    if (base < 1) continue;
    const dispatch = sameRange(loc, landingLoc);
    if (dispatch) legacyDispatch = true;
    scopes.push({ jumpStep: i, entryStep: i + 1, base, fn, loc: landingLoc, dispatch });
  }
  return { scopes, legacyDispatch };
}

export type ScopeEnd =
  /** The scope returns at step `step`, and execution continues at `nextPc`. */
  | { kind: "returns"; step: number; nextPc: number | null; blockStart: number }
  /** The frame ends, or the trace ends, before the scope returns. */
  | { kind: "open" };

const BLOCK_END = new Set(["JUMP", "JUMPI", "STOP", "RETURN", "REVERT", "INVALID", "SELFDESTRUCT"]);

/**
 * Find the JUMP that returns from `scope`, at or after step `from`, and the
 * first step of the basic block that holds it (the return block).
 */
export function findScopeEnd(
  steps: readonly ScopeStep[],
  heights: Int32Array,
  frame: { entry: number; end: number; depth: number },
  pcMap: ScopePcMap,
  scope: StackScope,
  from: number,
): ScopeEnd {
  const target = scope.base + scope.fn.returnSlots;
  for (let i = from; i < frame.end; i++) {
    const step = steps[i]!;
    if (step.depth !== frame.depth) continue;
    const height = heights[i]!;
    if (height < 0) break;
    if (step.op === "JUMP" && height === target && pcMap[step.pc]?.jumpType !== "i") {
      const next = steps[i + 1];
      const nextPc = i + 1 < frame.end && next && next.depth === frame.depth ? next.pc : null;
      return { kind: "returns", step: i, nextPc, blockStart: blockStartOf(steps, frame.depth, i, scope.entryStep) };
    }
    const low = lowestPop(step.op, height);
    if (low === null || low < scope.base) break;
  }
  return { kind: "open" };
}

/**
 * The first step of the basic block that holds step `at`, not below `floor`.
 * A block starts at a JUMPDEST or after a jump. Steps of a deeper call do
 * not split a block.
 */
export function blockStartOf(
  steps: readonly ScopeStep[],
  depth: number,
  at: number,
  floor: number,
): number {
  let k = at;
  while (k > floor) {
    if (steps[k]!.op === "JUMPDEST") return k;
    let p = k - 1;
    while (p >= floor && steps[p]!.depth !== depth) p--;
    if (p < floor) return floor;
    if (BLOCK_END.has(steps[p]!.op)) return k;
    k = p;
  }
  return floor;
}
