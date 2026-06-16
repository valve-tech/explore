import { createPublicClient, http, type PublicClient } from "viem";
import { getChain } from "./registry.js";
import { ApiError } from "../../lib/respond.js";

/**
 * Per-chain viem client factory (the 2026-05-29 multichain spec's
 * `getRpcClient`). Memoized one client per chainId, built from the
 * `ChainConfig` registry. Additive — the legacy single-chain `publicClient`
 * in ../rpc.ts is untouched; new multichain code resolves by id here.
 */

const clients = new Map<number, PublicClient>();

export function getRpcClient(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;

  const chain = getChain(chainId);
  if (!chain.rpcUrl) {
    // No keyed endpoint resolved — fail loudly rather than silently using a
    // rate-limited demo key. Provide PULSECHAIN_RPC_URL (covers all valve
    // chains) or a per-chain RPC URL env var.
    throw new ApiError(
      503,
      `No RPC endpoint configured for chain ${chainId} (${chain.name}). ` +
        `Set a keyed valve RPC via PULSECHAIN_RPC_URL or a per-chain RPC URL.`,
      { rpcUnconfigured: true, chainId },
    );
  }
  const client = createPublicClient({
    chain: chain.viemChain,
    transport: http(chain.rpcUrl, { batch: true, retryCount: 2, timeout: 30_000 }),
  });
  clients.set(chainId, client);
  return client;
}
