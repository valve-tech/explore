import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchNetworkHealth, fetchBlockLadder } from "../api/networkHealth";
import { useActiveChainId } from "../lib/activeChain";

/**
 * Network-health window for the active chain. `limit` grows when the user hits
 * "load more"; the backend serves the latest `limit` blocks and aggregates over
 * them server-side (all wei math stays in bigint there). keepPreviousData keeps
 * the table steady while a larger window loads; the head auto-refreshes.
 */
export function useNetworkHealth(limit: number) {
  const chainId = useActiveChainId();
  return useQuery({
    queryKey: ["network-health", chainId, limit],
    queryFn: () => fetchNetworkHealth(chainId, limit),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

/** One block's fee ladder, fetched on demand when a row is expanded. */
export function useBlockLadder(blockNumber: string | null) {
  const chainId = useActiveChainId();
  return useQuery({
    queryKey: ["network-health-ladder", chainId, blockNumber],
    queryFn: () => fetchBlockLadder(chainId, blockNumber!),
    enabled: !!blockNumber,
    staleTime: 60_000,
  });
}
