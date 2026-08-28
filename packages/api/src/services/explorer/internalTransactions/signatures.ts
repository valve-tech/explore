import type { SelectorSummary } from "../../signatures.js";
import type { InternalTransactionView } from "./transforms.js";

/**
 * Attaches a best-effort function signature to each internal call.
 *
 * The call tree renders `WPLS.balanceOf(0xcea0…)` instead of five columns of
 * addresses and hex, and the name is what makes that readable. It comes from
 * the same 4byte source the address rows use, with the same honesty rule: a
 * selector with several registered signatures reports its candidate count, so
 * the UI can mark a guess as a guess rather than printing it as a fact.
 */

export interface InternalCallSignature {
  /** The 4-byte selector, or "" for a call with no calldata (a plain send). */
  methodId: string;
  /** Full text signature, e.g. `transfer(address,uint256)`. Null when unknown. */
  methodSignature: string | null;
  /**
   * How many candidate signatures leave `methodSignature` in doubt.
   *
   * 1 means settled. Above 1 is the honest count for a selector nothing
   * vouches for, and the UI marks the name as a guess.
   */
  methodCandidates: number;
}

export type InternalTransactionWithSignature = InternalTransactionView &
  InternalCallSignature;

/** The 4-byte selector a call's input starts with, or "" if it has none. */
export function selectorOf(input: string): string {
  return input.length >= 10 ? input.slice(0, 10) : "";
}

export function attachSignatures(
  rows: InternalTransactionView[],
  summaries: Record<string, SelectorSummary>,
): InternalTransactionWithSignature[] {
  return rows.map((row) => {
    const methodId = selectorOf(row.input);
    const summary = methodId === "" ? undefined : summaries[methodId];
    return {
      ...row,
      methodId,
      methodSignature: summary?.textSignature ?? null,
      methodCandidates: summary?.candidateCount ?? 0,
    };
  });
}
