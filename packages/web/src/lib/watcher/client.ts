/**
 * viem PublicClient factory for client-side watching.
 *
 * This is the bridge between the bring-your-own-RPC seam (`resolveRpcUrl`) and
 * viem's subscription primitives (`watchBlocks` / `watchEvent`). Every watcher
 * subscription resolves its endpoint here, so a user who has set a per-chain
 * RPC override in Settings watches on THEIR node — the polling load never hits
 * Explore's proxy.
 *
 * Clients are memoized per (chainId, resolved endpoint): viem keeps internal
 * polling/observer state, so handing the same client to multiple subscriptions
 * lets viem de-dupe the underlying `eth_blockNumber`/`eth_getLogs` polls. When
 * the user changes their override the resolved endpoint changes, the cache key
 * changes, and a fresh client is built — the stale one simply falls out of use.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { resolveRpcUrl } from "../rpcEndpoint.js";

const cache = new Map<string, PublicClient>();

/**
 * A viem PublicClient pointed at the resolved endpoint for `chainId`. We omit
 * a `chain` object on purpose: raw reads/watching don't need chain-specific
 * formatters, and synthesizing a viem chain for every config-driven custom id
 * (PulseChain, self-host chains) would just be ceremony. The default polling
 * interval (4s) is fine for an ambient, tab-open watcher.
 */
export function getPublicClient(chainId: number): PublicClient {
  const endpoint = resolveRpcUrl(chainId);
  const key = `${chainId}|${endpoint}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const client = createPublicClient({
    // retryCount: 0 — on a failed poll we wait for the next interval rather than
    // retrying immediately (a rate-limited node must not be hammered). The 8s
    // interval is plenty for an ambient, tab-open watcher and halves the
    // baseline load vs viem's 4s default.
    transport: http(endpoint, { batch: true, retryCount: 0 }),
    pollingInterval: 8_000,
  });
  cache.set(key, client);
  return client;
}

/** Drop all memoized clients — used by tests and on hard endpoint resets. */
export function resetPublicClients(): void {
  cache.clear();
}
