/**
 * A token's recent Transfer history for the contract chart, via the backend's
 * chifra-backed endpoint (`GET /api/chifra/transfers?token&window`) — no
 * client-side `eth_getLogs`, no raw RPC. "Load more" widens the window
 * (24h → 7d → 30d); the server caches sealed windows, so widening is cheap and
 * the prior window stays on screen (keepPreviousData) while the next loads.
 */

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTokenTransfers,
  type ChifraTransfer,
  type ChifraWindow,
} from "../api/explorer";
import { useActiveChainId } from "../lib/activeChain";

const WINDOWS: ChifraWindow[] = ["24h", "7d", "30d"];

export type LoadStatus = "loading" | "success" | "error";

export interface UseTokenTransfers {
  records: ChifraTransfer[];
  status: LoadStatus;
  error: string | null;
  /** Inclusive block window the records cover. */
  fromBlock: number | null;
  headBlock: number | null;
  /** The history window currently loaded. */
  window: ChifraWindow;
  loadingMore: boolean;
  loadMore: () => void;
  /** False once the widest window (30d) is loaded. */
  canLoadMore: boolean;
}

export function useTokenTransfers(token: string): UseTokenTransfers {
  const chainId = useActiveChainId();
  const [window, setWindow] = useState<ChifraWindow>("24h");

  const query = useQuery({
    queryKey: ["token-transfers", chainId, token.toLowerCase(), window],
    queryFn: () => fetchTokenTransfers(token, window, chainId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const idx = WINDOWS.indexOf(window);
  return {
    records: query.data?.records ?? [],
    status: query.isPending ? "loading" : query.isError ? "error" : "success",
    error:
      query.error instanceof Error
        ? query.error.message
        : query.isError
          ? "Failed to load transfers"
          : null,
    fromBlock: query.data?.firstBlock ?? null,
    headBlock: query.data?.lastBlock ?? null,
    window,
    loadingMore: query.isFetching && !query.isPending,
    loadMore: () => {
      if (idx < WINDOWS.length - 1) setWindow(WINDOWS[idx + 1]!);
    },
    canLoadMore: idx < WINDOWS.length - 1,
  };
}
