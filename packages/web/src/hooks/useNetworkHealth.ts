import {
  useQuery,
  keepPreviousData,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchNetworkHealth, fetchBlockLadder } from "../api/networkHealth";
import {
  fetchNetworkHealthViaRpc,
  fetchBlockLadderViaRpc,
} from "../lib/byoNetworkHealth";
import { useActiveChainId } from "../lib/activeChain";
import { isRpcOverridden } from "../lib/rpcEndpoint";
import { chainBurnsBaseFee } from "../lib/chains";

/**
 * Network-health window for the active chain. `limit` grows when the user picks a
 * wider window; by default the backend serves the latest `limit` blocks and
 * aggregates server-side. When a per-chain RPC override is set (BYO-RPC), the
 * same window is computed in the browser straight from the user's node.
 *
 * BYO streaming: on a window's FIRST load the result is painted progressively
 * (newest blocks first) via `setQueryData` as each chunk arrives, so a wide
 * window doesn't block on the whole fetch. Background refetches (same key, data
 * already present) fetch the full window silently — no shrink-then-grow flicker
 * on the 20s refresh. keepPreviousData keeps the table steady across switches;
 * the head auto-refreshes.
 */
export function useNetworkHealth(limit: number) {
  const chainId = useActiveChainId();
  const byo = isRpcOverridden(chainId);
  const queryClient = useQueryClient();
  const queryKey = ["network-health", chainId, limit, byo ? "byo" : "api"] as const;
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      if (!byo) return fetchNetworkHealth(chainId, limit);
      // Stream only when this window has no data yet (cold load). A refetch over
      // an already-loaded window skips onProgress and replaces at the end.
      const hasData = queryClient.getQueryData(queryKey) !== undefined;
      return fetchNetworkHealthViaRpc(chainId, limit, chainBurnsBaseFee(chainId), {
        signal,
        onProgress: hasData
          ? undefined
          : (partial) => queryClient.setQueryData(queryKey, partial),
      });
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 20_000,
    // One bounded retry, then surface the error (a rate-limited / slow chain
    // should show a clear failure with a Retry, not loop on the loader forever).
    retry: 1,
    retryDelay: 1_000,
  });
}

/** One block's fee ladder, fetched on demand when a row is expanded. Reads from
 *  the user's node when a per-chain RPC override is set, else the backend. */
export function useBlockLadder(blockNumber: string | null) {
  const chainId = useActiveChainId();
  const byo = isRpcOverridden(chainId);
  return useQuery({
    queryKey: ["network-health-ladder", chainId, blockNumber, byo ? "byo" : "api"],
    queryFn: ({ signal }) =>
      byo
        ? fetchBlockLadderViaRpc(chainId, blockNumber!, chainBurnsBaseFee(chainId), signal)
        : fetchBlockLadder(chainId, blockNumber!),
    enabled: !!blockNumber,
    staleTime: 60_000,
  });
}
