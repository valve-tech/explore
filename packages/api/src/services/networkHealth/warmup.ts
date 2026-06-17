/**
 * Boot-time, best-effort cache warming for the launch-set chains.
 *
 * Policy (chosen deliberately — "lenient / background"): warming NEVER blocks
 * startup, and a chain that can't warm — missing RPC key, or a configured node
 * that's down — does NOT take the server down. It's recorded as `degraded` and
 * left to warm lazily on the next request, where `getRpcClient` still surfaces
 * a loud 503 for an unconfigured chain ("fail out" stays intact, just at
 * request time rather than as a hard boot failure).
 *
 * `/health` reads {@link getChainWarmStatus} so a deploy can SEE which chains
 * came up and, if it wants, poll {@link allChainsReady} as a soft readiness
 * gate without the HTTP status ever flipping for one chain's outage.
 *
 * This is a one-shot warm, not a background poller — idle chains still cost
 * nothing after boot (the cache's head top-up stays request-driven).
 */

import { listChains, type ChainConfig } from "../chains/registry.js";
import { getNetworkHealth, INITIAL_WINDOW } from "./cache.js";

export type ChainWarmState = "warming" | "ready" | "degraded";

export interface ChainWarmStatus {
  chainId: number;
  name: string;
  state: ChainWarmState;
  /** Blocks resident in the cache window after the warm (0 until ready). */
  blocks: number;
  /** Whether the chain resolved to a non-empty rpcUrl at boot. */
  rpcConfigured: boolean;
  /** Present only when `state === "degraded"`. */
  error?: string;
}

const status = new Map<number, ChainWarmStatus>();

function set(s: ChainWarmStatus): void {
  status.set(s.chainId, s);
}

/** Per-chain warm status, ascending by chainId. Consumed by `/health`. */
export function getChainWarmStatus(): ChainWarmStatus[] {
  return [...status.values()].sort((a, b) => a.chainId - b.chainId);
}

/** True when every configured chain has warmed (soft readiness signal). */
export function allChainsReady(): boolean {
  const all = [...status.values()];
  return all.length > 0 && all.every((s) => s.state === "ready");
}

async function warmChain(chain: ChainConfig): Promise<void> {
  set({
    chainId: chain.chainId,
    name: chain.name,
    state: "warming",
    blocks: 0,
    rpcConfigured: true,
  });
  try {
    const res = await getNetworkHealth(chain.chainId, null, INITIAL_WINDOW);
    set({
      chainId: chain.chainId,
      name: chain.name,
      state: "ready",
      blocks: res.blocks.length,
      rpcConfigured: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({
      chainId: chain.chainId,
      name: chain.name,
      state: "degraded",
      blocks: 0,
      rpcConfigured: true,
      error: message,
    });
    console.error(
      `[warmup] chain ${chain.chainId} (${chain.name}) failed to warm: ${message}`,
    );
  }
}

/**
 * Kick off background warming of every configured chain. Fire-and-forget:
 * returns immediately, chains warm concurrently, and failures are recorded
 * rather than thrown. A chain with no rpcUrl is marked degraded synchronously
 * (no RPC call) so `/health` flags the misconfiguration the instant we boot.
 */
export function warmAllChains(chains: ChainConfig[] = listChains()): void {
  for (const chain of chains) {
    if (!chain.rpcUrl) {
      set({
        chainId: chain.chainId,
        name: chain.name,
        state: "degraded",
        blocks: 0,
        rpcConfigured: false,
        error: "No RPC endpoint configured — set a keyed RPC URL for this chain",
      });
      console.error(
        `[warmup] chain ${chain.chainId} (${chain.name}) has no RPC URL — requests will 503`,
      );
      continue;
    }
    void warmChain(chain);
  }
}

/** Test seam: clear recorded warm status. */
export function __resetWarmStatus(): void {
  status.clear();
}
