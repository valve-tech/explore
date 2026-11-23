import type { StepDetail } from "../../../../api/debugger";
import { activeFrame, type FrameRange } from "../lineToStepIndex";
import { normalizeStorage, normalizeWord } from "./slotWord";

/**
 * Which storage does a step read, and what does the trace know about it?
 *
 * A struct log gives a storage map only at an SLOAD or an SSTORE step. The
 * map holds every slot that the STORAGE ADDRESS touched so far in the
 * transaction. The storage address of a DELEGATECALL frame is the storage
 * address of its caller, not the address of the code that runs.
 *
 * The tracer does not roll the map back when a call reverts. A slot that a
 * reverted call wrote keeps the reverted value. This module refuses to answer
 * for a storage address after such a call.
 */

export interface SkeletonStep { op: string; depth: number }

interface StorageOp {
  step: number;
  /** Storage address, lowercase. Null when the model cannot tell. */
  ctx: string | null;
  write: boolean;
  /** The write is undone from this step on. Infinity when it stays. */
  undoneFrom: number;
}

export interface StorageModel {
  frames: FrameRange[];
  ctxOfFrame: Map<FrameRange, string | null>;
  ops: StorageOp[];
  /** First SSTORE whose storage address is unknown. Infinity when none. */
  firstUnknownWrite: number;
}

export type FrameStorage =
  | {
      status: "known";
      /** Storage address of the frame, lowercase. For a proxy call this is the proxy. */
      address: string;
      /** Every slot the address touched up to this step. Keys and values are "0x" + 64 hex. */
      storage: Record<string, string>;
      /** The map before this step, when this step is an SLOAD or an SSTORE. Otherwise null. */
      prevStorage: Record<string, string> | null;
      /** The slot that this step writes, when this step is an SSTORE. */
      writtenSlot: string | null;
      snapshotStep: number | null;
    }
  /** The snapshot is at `step`, and that step is not in the loaded detail. */
  | { status: "need-detail"; address: string; step: number }
  | { status: "unknown"; reason: string };

const ENDS_OK = new Set(["RETURN", "STOP", "SELFDESTRUCT"]);
const KEEPS_CALLER_STORAGE = new Set(["DELEGATECALL", "CALLCODE"]);
const OWN_STORAGE = new Set(["CALL", "STATICCALL", "CREATE", "CREATE2"]);

/** A frame fails unless its last step is its own RETURN, STOP or SELFDESTRUCT. */
function frameFailed(steps: readonly SkeletonStep[], f: FrameRange): boolean {
  const last = steps[f.end - 1];
  return !(last && last.depth === f.depth && ENDS_OK.has(last.op));
}

/**
 * Walk the trace one time. Give each frame its storage address, and list each
 * SLOAD and SSTORE with the storage address it uses. Memoize the result per
 * trace: the walk reads every step.
 */
export function buildStorageModel(
  steps: readonly SkeletonStep[],
  frames: readonly FrameRange[],
): StorageModel {
  const sorted = [...frames].sort((a, b) => a.entry - b.entry || a.depth - b.depth);
  const ctxOfFrame = new Map<FrameRange, string | null>();
  const ops: StorageOp[] = [];
  const stack: { f: FrameRange; ctx: string | null; failed: boolean }[] = [];
  let firstUnknownWrite = Infinity;
  let next = 0;
  for (let s = 0; s < steps.length; s++) {
    while (stack.length > 0 && stack[stack.length - 1]!.f.end <= s) stack.pop();
    while (next < sorted.length && sorted[next]!.entry <= s) {
      const f = sorted[next++]!;
      if (f.entry < s || f.end <= s) { ctxOfFrame.set(f, null); continue; }
      const parent = stack[stack.length - 1];
      const opener = steps[s - 1]?.op ?? "";
      let ctx: string | null = null;
      if (s === 0 || OWN_STORAGE.has(opener)) ctx = f.addr?.toLowerCase() ?? null;
      else if (KEEPS_CALLER_STORAGE.has(opener)) ctx = parent?.ctx ?? null;
      ctxOfFrame.set(f, ctx);
      stack.push({ f, ctx, failed: frameFailed(steps, f) });
    }
    const { op, depth } = steps[s]!;
    if (op !== "SLOAD" && op !== "SSTORE") continue;
    const top = stack[stack.length - 1];
    const ctx = top && top.f.depth === depth ? top.ctx : null;
    const write = op === "SSTORE";
    let undoneFrom = Infinity;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.failed) { undoneFrom = stack[k]!.f.end; break; }
    }
    // An SSTORE that is the last step of a failed frame did not write.
    if (write && undoneFrom === s + 1) undoneFrom = s;
    if (write && ctx === null && firstUnknownWrite === Infinity) firstUnknownWrite = s;
    ops.push({ step: s, ctx, write, undoneFrom });
  }
  for (const f of sorted) if (!ctxOfFrame.has(f)) ctxOfFrame.set(f, null);
  return { frames: [...frames], ctxOfFrame, ops, firstUnknownWrite };
}

/** The storage address of the frame that runs `step`. Null when unknown. */
export function storageAddressAt(model: StorageModel, step: number): string | null {
  const frame = activeFrame(model.frames, step);
  return frame ? model.ctxOfFrame.get(frame) ?? null : null;
}

/**
 * The storage map of the frame that runs `step`, as the trace knows it at
 * that step. `detail` is the loaded per-step detail (any set of chunks).
 */
export function frameStorageAt(
  model: StorageModel,
  detail: Readonly<Record<number, StepDetail>> | null | undefined,
  step: number,
): FrameStorage {
  const address = storageAddressAt(model, step);
  if (!address) return { status: "unknown", reason: "storage address of the frame is unknown" };
  if (model.firstUnknownWrite < step) {
    return { status: "unknown", reason: "an earlier write has an unknown storage address" };
  }
  let latest: StorageOp | null = null;
  let before: StorageOp | null = null;
  for (const op of model.ops) {
    if (op.step > step) break;
    if (op.ctx !== address) continue;
    if (op.write && op.undoneFrom <= step) {
      return { status: "unknown", reason: "a reverted call wrote this storage; the trace keeps the reverted value" };
    }
    before = latest;
    latest = op;
  }
  if (!latest) {
    return { status: "known", address, storage: {}, prevStorage: null, writtenSlot: null, snapshotStep: null };
  }
  const d = detail?.[latest.step];
  if (!d) return { status: "need-detail", address, step: latest.step };
  const storage = normalizeStorage(d.storage ?? {});
  // The slot operand of SLOAD and SSTORE is the top of the stack. A snapshot
  // without that slot is not the cumulative map this module expects.
  const top = d.stack?.[d.stack.length - 1];
  const operand = typeof top === "string" ? normalizeWord(top) : null;
  if (!operand || !(operand in storage)) {
    return { status: "unknown", reason: `the trace has no storage snapshot at step ${latest.step}` };
  }
  // At an SSTORE the map must already hold the value that the step writes.
  const second = d.stack?.[d.stack.length - 2];
  if (latest.write && (typeof second !== "string" || normalizeWord(second) !== storage[operand])) {
    return { status: "unknown", reason: `the snapshot at step ${latest.step} does not hold the written value` };
  }
  // The map must be cumulative: it must still hold the slot of the storage op before it.
  const pd = before ? detail?.[before.step] : null;
  const pTop = pd?.stack?.[pd.stack.length - 1];
  const pOperand = typeof pTop === "string" ? normalizeWord(pTop) : null;
  if (pd && (!pOperand || !(pOperand in storage))) {
    return { status: "unknown", reason: "the storage snapshots of the trace are not cumulative" };
  }
  if (latest.step !== step) {
    return { status: "known", address, storage, prevStorage: null, writtenSlot: null, snapshotStep: latest.step };
  }
  const prevStorage = before ? (pd ? normalizeStorage(pd.storage ?? {}) : null) : {};
  return {
    status: "known", address, storage, prevStorage,
    writtenSlot: latest.write ? operand : null, snapshotStep: latest.step,
  };
}
