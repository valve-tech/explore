import { traceTransaction, type CallFrame } from "../tracer.js";
import {
  flattenInternalCalls,
  type InternalTransactionView,
} from "./internalTransactions/transforms.js";

export type InternalTransaction = InternalTransactionView;

export interface InternalTransactionsResult {
  transactions: InternalTransaction[];
  /**
   * False when no trace source answered. An empty `transactions` is only a
   * fact about the chain when this is true.
   */
  available: boolean;
}

/**
 * True when an empty internal-call list means "no trace source answered",
 * not "this transaction made no internal calls".
 *
 * The two empties look identical on the wire, and only the trace root tells
 * them apart. `traceTransaction` never throws: it walks cache → debug RPC →
 * anvil replay and reports total failure as `trace: null` plus an `error`
 * string. A successful trace always returns a root `CallFrame` — the
 * top-level call itself — and `flattenInternalCalls` counts only that root's
 * descendants. A plain value transfer therefore traces fine and flattens to
 * `[]`, which is an honest empty.
 *
 * So: a null root is the outage, and a present root with no children is the
 * real answer.
 */
export function isTraceUnavailable(
  root: CallFrame | null | undefined,
): root is null | undefined {
  return root === null || root === undefined;
}

function unavailable(): InternalTransactionsResult {
  return { transactions: [], available: false };
}

/**
 * Internal calls (CALL / DELEGATECALL / etc.) that happened *within* the
 * given top-level transaction, flattened from the debug_traceTransaction
 * call tree (cached by the tracer; anvil-fork replay covers nodes without
 * the debug API).
 *
 * Reports `available: false` when no trace source answered, so the caller
 * never presents "the tracer is down" as "this transaction made no internal
 * calls". A chain whose RPC has no `debug_*` namespace hits that on every
 * transaction, which is exactly why it must not read as a fact.
 */
export async function getInternalTransactions(
  hash: string,
): Promise<InternalTransactionsResult> {
  let root: CallFrame | null;
  try {
    root = (await traceTransaction(hash)).trace;
  } catch {
    return unavailable();
  }

  if (isTraceUnavailable(root)) return unavailable();

  return { transactions: flattenInternalCalls(root), available: true };
}
