/**
 * A token's recent Transfer history for the contract chart.
 *
 * By default it reads our endpoint (`GET /api/chifra/transfers`). The endpoint
 * answers one bounded page, newest first, with a `nextCursor` for the next
 * older page. If the user has set a per-chain RPC override (BYO-RPC), it
 * instead reads the Transfer logs straight from THEIR node via `eth_getLogs`
 * (see byoTransfers), so heavy reads run on their infra, not ours. That path
 * returns the whole window as one page.
 *
 * "Load more" first reads the next page of the current window. When the
 * window has no more pages, it widens the window (24h → 7d → 30d).
 * keepPreviousData keeps the prior window on screen while the next loads.
 */

import { useState } from "react";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchTokenTransfers,
  type ChifraTransfer,
  type ChifraWindow,
} from "../api/explorer";
import { fetchTransfersViaRpc } from "../lib/byoTransfers";
import { isRpcOverridden } from "../lib/rpcEndpoint";
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
  /** True when older pages of the current window remain. */
  hasMorePages: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  /** False once the widest window (30d) is fully loaded. */
  canLoadMore: boolean;
}

export function useTokenTransfers(token: string): UseTokenTransfers {
  const chainId = useActiveChainId();
  const [window, setWindow] = useState<ChifraWindow>("24h");
  const byo = isRpcOverridden(chainId);

  const query = useInfiniteQuery({
    queryKey: ["token-transfers", chainId, token.toLowerCase(), window, byo ? "byo" : "api"],
    queryFn: ({ pageParam }) =>
      byo
        ? fetchTransfersViaRpc(token, window, chainId)
        : pageParam === undefined
          ? fetchTokenTransfers(token, window, chainId)
          : fetchTokenTransfers(token, window, chainId, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    // A refetch re-reads every page from its old cursor while the head page
    // moves, which leaves a gap between page 1 and page 2. Poll only while
    // one page is on screen.
    refetchInterval: (q) => ((q.state.data?.pages.length ?? 0) > 1 ? false : 60_000),
  });

  const pages = query.data?.pages ?? [];
  const idx = WINDOWS.indexOf(window);
  const hasMorePages = query.hasNextPage;
  const canWiden = idx < WINDOWS.length - 1;
  return {
    records: pages.flatMap((p) => p.records),
    status: query.isPending ? "loading" : query.isError ? "error" : "success",
    error:
      query.error instanceof Error
        ? query.error.message
        : query.isError
          ? "Failed to load transfers"
          : null,
    fromBlock: pages.length ? pages[pages.length - 1]!.firstBlock : null,
    headBlock: pages.length ? pages[0]!.lastBlock : null,
    window,
    hasMorePages,
    loadingMore: query.isFetching && !query.isPending,
    loadMore: () => {
      if (hasMorePages) void query.fetchNextPage();
      else if (canWiden) setWindow(WINDOWS[idx + 1]!);
    },
    canLoadMore: hasMorePages || canWiden,
  };
}
