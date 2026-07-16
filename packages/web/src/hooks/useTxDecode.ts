import { useEffect, useState } from "react";
import {
  fetchTransactionDecode,
  type TransactionDecode,
} from "../api/explorer";
import { isRpcOverridden } from "../lib/rpcEndpoint";

export type TxDecodeState = "pending" | "ready" | "unavailable";

export interface TxDecodeResult extends TransactionDecode {
  state: TxDecodeState;
}

const EMPTY: TransactionDecode = { decodedInput: null, decodedLogs: [] };

/**
 * Fetches the decode half of the tx page (GET /api/tx/:hash/decode) separately
 * from core, so the page paints without waiting on a verified-source upstream.
 *
 * Deliberately a plain fetch hook, NOT TanStack Query: the app persists queries
 * to IndexedDB with staleTime/gcTime/maxAge all Infinity, which would pin a
 * decode that failed during an upstream outage forever. A reload must retry.
 *
 * `enabled === false` (BYO-RPC, where the complete payload already carries
 * decode) short-circuits to a ready/empty result and issues no request.
 */
export function useTxDecode(
  hash: string,
  chainId: number,
  enabled: boolean = !isRpcOverridden(chainId),
): TxDecodeResult {
  const [result, setResult] = useState<TxDecodeResult>({
    ...EMPTY,
    state: enabled ? "pending" : "ready",
  });

  useEffect(() => {
    if (!enabled) {
      setResult({ ...EMPTY, state: "ready" });
      return;
    }
    let cancelled = false;
    setResult({ ...EMPTY, state: "pending" });

    fetchTransactionDecode(hash, chainId)
      .then((decode) => {
        if (!cancelled) setResult({ ...decode, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setResult({ ...EMPTY, state: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [hash, chainId, enabled]);

  return result;
}
