import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchNetworkHealth, fetchBlockLadder } from "../api/networkHealth";
import {
  fetchNetworkHealthViaRpc,
  fetchBlockLadderViaRpc,
} from "../lib/byoNetworkHealth";
import { useActiveChainId } from "../lib/activeChain";
import { isRpcOverridden } from "../lib/rpcEndpoint";
import { chainBurnsBaseFee } from "../lib/chains";

/**
 * Network-health window for the active chain. `limit` grows when the user hits
 * "load more"; by default the backend serves the latest `limit` blocks and
 * aggregates server-side. When a per-chain RPC override is set (BYO-RPC), the
 * same window is computed in the browser straight from the user's node — same
 * shape, same pure analysis. keepPreviousData keeps the table steady while a
 * larger window loads; the head auto-refreshes.
 */
export function useNetworkHealth(limit: number) {
  const chainId = useActiveChainId();
  const byo = isRpcOverridden(chainId);
  return useQuery({
    queryKey: ["network-health", chainId, limit, byo ? "byo" : "api"],
    queryFn: () =>
      byo
        ? fetchNetworkHealthViaRpc(chainId, limit, chainBurnsBaseFee(chainId))
        : fetchNetworkHealth(chainId, limit),
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
    queryFn: () =>
      byo
        ? fetchBlockLadderViaRpc(chainId, blockNumber!, chainBurnsBaseFee(chainId))
        : fetchBlockLadder(chainId, blockNumber!),
    enabled: !!blockNumber,
    staleTime: 60_000,
  });
}
