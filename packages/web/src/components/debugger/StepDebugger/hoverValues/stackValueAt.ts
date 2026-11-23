import { activeFrame, type FrameRange } from "../lineToStepIndex";
import { findLocalDecl } from "../sourceNav/clickContext";
import { formatStackVar, wordOf, type TypeResolver } from "./formatStackValue";
import type { StackVar } from "./functionSignature";
import { isInside, isPlainUse, offsetInScope } from "./hoverPosition";
import { matchesCalldata, returnSlotsPushed } from "./slotChecks";
import { writesSlot } from "./stackHeights";
import {
  blockStartOf, findScopeEnd, looksViaIr, walkStackScopes,
  type ScopePcMap, type ScopeStep, type StackScope,
} from "./stackScopes";
import type { HoverValue } from "./types";

export interface StackValueInput {
  /** The identifier under the pointer. */
  word: string;
  /** Position of the identifier: file name, 1-based line, 0-based column. */
  file: string;
  line: number;
  col: number;
  /** The opcode skeleton of the whole trace. */
  steps: readonly ScopeStep[];
  /** computeStackHeights(steps). Memoize it: it does not change with the cursor. */
  heights: Int32Array;
  frames: readonly FrameRange[];
  currentStep: number;
  /** Source maps by lower-case contract address. */
  traceSourceMaps: Readonly<Record<string, ScopePcMap | undefined>>;
  /** Stack and memory at currentStep, or null while the chunk loads. */
  detail: { stack: readonly string[]; memory?: readonly string[] | null } | null;
  /** Address of the contract the source pane shows. Omit it when the pane shows the active frame. */
  sourceAddr?: string | null;
  /** Compiler version of the active frame's contract, for example "0.6.6+commit.6c089d02". */
  compilerVersion?: string | null;
  /** True when the contract was compiled through the IR pipeline. */
  viaIR?: boolean;
  /**
   * False when the contract was compiled with the optimizer off. Then the
   * last block of a function is also readable. Omit it when not known.
   */
  optimizer?: boolean;
  /** Call data of the active frame, to decode calldata values and to cross-check arguments. */
  calldata?: string | null;
  /** Resolves enum, contract and struct names. See userTypeResolver. */
  resolveType?: TypeResolver;
}

const WEAK_NOTE = "not cross-checked: this function does not return in the trace";

/** True for a compiler older than 0.7.5, which has no IR pipeline. */
function isPreIrCompiler(version: string | null | undefined): boolean {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return major === 0 && (minor < 7 || (minor === 7 && patch < 5));
}

function findVar(scope: StackScope, word: string): { v: StackVar; index: number; isReturn: boolean } | null {
  const { fn, base } = scope;
  const hits = [
    ...fn.params.filter((p) => p.name === word).map((v) => ({ v, index: base + v.offset, isReturn: false })),
    ...fn.returns
      .filter((r) => r.name === word)
      .map((v) => ({ v, index: base + fn.paramSlots + v.offset, isReturn: true })),
  ];
  if (hits.length !== 1) return null;
  // A local with the same name can shadow the variable. Locals are not decoded.
  if (findLocalDecl(fn.stripped, fn.bodyStart, fn.stripped.length, word)) return null;
  if (new RegExp("\\blet\\b[^\\n;=]*\\b" + word.replace(/[$]/g, "\\$") + "\\b").test(fn.stripped.slice(fn.bodyStart))) return null;
  return hits[0]!;
}

/**
 * The value of a function parameter or a named return variable at the current
 * step, read from the EVM stack. Returns null when the identifier is not such
 * a variable of an open function in the active frame, and in every case where
 * the stack slot is not certain. A missing value is correct; a wrong value is not.
 */
export function stackValueAt(input: StackValueInput): HoverValue | null {
  const { word, steps, heights, currentStep, detail } = input;
  if (input.viaIR === true || !detail || !/^[A-Za-z_$][\w$]*$/.test(word)) return null;
  const frame = activeFrame(input.frames as FrameRange[], currentStep);
  const addr = frame?.addr?.toLowerCase();
  if (!frame || !addr || steps[currentStep]?.depth !== frame.depth) return null;
  if (input.sourceAddr && input.sourceAddr.toLowerCase() !== addr) return null;
  const pcMap = input.traceSourceMaps[addr];
  if (!pcMap || looksViaIr(pcMap)) return null;
  const stack = detail.stack;
  // The real stack must agree with the height computed from the skeleton.
  if (heights[currentStep] !== stack.length) return null;

  const walk = walkStackScopes(steps, heights, frame, pcMap, currentStep);
  if (!walk || !(walk.legacyDispatch || isPreIrCompiler(input.compilerVersion))) return null;

  let scope: StackScope | undefined;
  for (let i = walk.scopes.length - 1; i >= 0 && !scope; i--) {
    const s = walk.scopes[i]!;
    const offset = offsetInScope(s, input.file, input.line, input.col);
    if (offset >= 0 && isPlainUse(s.fn.stripped, offset, word)) scope = s;
  }
  if (!scope) return null;
  const hit = findVar(scope, word);
  if (!hit) return null;
  const { v, index } = hit;
  const last = index + v.slots - 1;
  if (last >= stack.length || scope.base - 1 >= stack.length) return null;

  // The slot below the parameters must still hold the return label.
  const label = wordOf(stack[scope.base - 1]!);
  if (label === null) return null;
  const end = findScopeEnd(steps, heights, frame, pcMap, scope, currentStep);
  let note: string | undefined;
  if (end.kind === "returns") {
    if (end.nextPc === null || BigInt(end.nextPc) !== label) return null;
  } else if (label !== BigInt(steps[scope.jumpStep]!.pc + 1)) {
    if (label > 0xffffn) return null;
    const proven = scope.dispatch && !!input.calldata && matchesCalldata(scope, stack, input.calldata, input.resolveType);
    if (!proven) note = WEAK_NOTE;
  }

  // The optimizer keeps the slots of the variables only between basic blocks.
  // In a block, an opcode can remove a slot and put a temporary value there.
  let scanFrom = blockStartOf(steps, frame.depth, currentStep, scope.entryStep);
  if (hit.isReturn && scanFrom === scope.entryStep) {
    // The return slots do not exist at the entry. Accept them only when the
    // code pushes them first, in order, as the code generator writes them.
    const slotsNeeded = v.offset + v.slots;
    if (!returnSlotsPushed(steps, pcMap, frame.depth, scope, slotsNeeded)) return null;
    scanFrom = scope.entryStep + 1 + slotsNeeded;
  }
  // In the return block the code moves the return values over these slots.
  const inReturnBlock = end.kind === "returns" && end.blockStart <= currentStep;
  for (let i = scanFrom; i <= currentStep; i++) {
    if (steps[i]!.depth !== frame.depth) continue;
    if (heights[i]! <= last) return null;
    if (!inReturnBlock || i === currentStep) continue;
    for (let slot = index; slot <= last; slot++) {
      if (writesSlot(steps[i]!.op, heights[i]!, slot) === false) continue;
      // Code that is not optimized keeps its source locations: the return
      // sequence maps to the whole function, an assignment to its statement.
      const loc = pcMap[steps[i]!.pc];
      const assignment = input.optimizer === false && steps[i]!.op.startsWith("SWAP") && !!loc && isInside(loc, scope.loc);
      if (!assignment) return null;
    }
  }

  const words: bigint[] = [];
  for (let slot = index; slot <= last; slot++) {
    const w = wordOf(stack[slot]!);
    if (w === null) return null;
    words.push(w);
  }
  const formatted = formatStackVar(v, words, {
    memory: detail.memory,
    calldata: input.calldata,
    resolveType: input.resolveType,
  });
  if (!formatted) return null;
  const notes = [formatted.note, note].filter(Boolean).join("; ");
  return {
    name: word,
    type: v.location ? `${v.type} ${v.location}` : v.type,
    value: formatted.value,
    source: formatted.source,
    ...(notes ? { note: notes } : {}),
  };
}
