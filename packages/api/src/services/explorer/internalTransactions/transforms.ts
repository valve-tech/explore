import { formatEther } from "viem";
import type { CallFrame } from "../../tracer.js";

/**
 * Pure flattening of a debug_traceTransaction call tree into the
 * internal-transaction rows the explorer wire shape carries. The root
 * frame is the top-level transaction itself, so only its descendants
 * count as "internal".
 *
 * Defensive defaults mirror the rest of this directory's mappers: hex
 * quantities parse through BigInt with "0x0" fallbacks, a missing `type`
 * renders as "CALL", and a frame's `error` doubles as both `errCode` and
 * the `isError` flag (the 0/1 string encoding consumers already test).
 */

export interface InternalTransactionView {
  from: string;
  to: string;
  value: string;
  valuePLS: string;
  type: string;
  gas: string;
  gasUsed: string;
  input: string;
  /** Return data of the call, `0x` when it returned nothing. */
  output: string;
  errCode: string;
  isError: string;
  /**
   * How deep this call sits under the transaction. A direct call from the
   * top-level transaction is 1; a call it makes in turn is 2.
   *
   * The rows stay a flat list in execution order, and depth is what lets a
   * consumer rebuild the tree from them. Do NOT try to infer the tree from
   * `from` chaining instead: a DELEGATECALL keeps the caller's address, so
   * parent and child report the same `from` and the nesting is lost.
   */
  depth: number;
}

function hexToDecimal(hex: string | undefined): string {
  if (!hex) return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

function mapFrame(frame: CallFrame, depth: number): InternalTransactionView {
  const value = hexToDecimal(frame.value);
  return {
    from: frame.from ?? "",
    to: frame.to ?? "",
    value,
    valuePLS: formatEther(BigInt(value)),
    type: frame.type || "CALL",
    gas: hexToDecimal(frame.gas),
    gasUsed: hexToDecimal(frame.gasUsed),
    input: frame.input ?? "0x",
    output: frame.output ?? "0x",
    errCode: frame.error ?? "",
    isError: frame.error ? "1" : "0",
    depth,
  };
}

/**
 * Depth-first flatten of the root's descendants, in execution order, each row
 * carrying the depth it sat at.
 *
 * Depth-first order plus a depth number is a lossless encoding of the tree:
 * a row's parent is the nearest earlier row with a smaller depth. The list
 * stays flat, so every existing consumer keeps working unchanged.
 */
export function flattenInternalCalls(
  root: CallFrame,
): InternalTransactionView[] {
  const out: InternalTransactionView[] = [];
  const walk = (frame: CallFrame, depth: number): void => {
    for (const child of frame.calls ?? []) {
      out.push(mapFrame(child, depth));
      walk(child, depth + 1);
    }
  };
  walk(root, 1);
  return out;
}
