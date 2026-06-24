/**
 * One-shot ERC-20 metadata (decimals + symbol) for the transfer watcher.
 *
 * The transfer matcher (`matchErc20Transfer`) is pure and renders whatever raw
 * value it's handed. This module is the SINGLE effect that turns a token address
 * into the decimals/symbol needed to show "1.5 USDC" instead of "1500000". By
 * default it reads through the backend's `/api/token/:addr/meta` endpoint
 * (server-side, cached); when a per-chain RPC override is set the read goes
 * straight to the user's node via `eth_call` (bring-your-own-RPC) — either way
 * the cache below is transport-agnostic.
 *
 * Memoized per (chainId, token): a token is read at most once per session no
 * matter how many rules reference it. A token that can't answer `decimals()`
 * (the endpoint returns `decimals: null`) yields `null`; a FAILED request is
 * evicted rather than cached, so a transient hiccup self-heals on the next
 * transfer instead of poisoning the token's display for the rest of the session.
 */

import { fetchTokenMeta } from "../../api/explorer";
import { fetchTokenMetaViaRpc } from "../byoTokenMeta";
import { isRpcOverridden } from "../rpcEndpoint";
import type { TokenMeta } from "./matchers.js";

/** In-flight or resolved metadata per `${chainId}|${lowercased token}`. */
const cache = new Map<string, Promise<TokenMeta | null>>();

function cacheKey(chainId: number, address: string): string {
  return `${chainId}|${address.toLowerCase()}`;
}

/**
 * Resolve a token's decimals (+ optional symbol), memoized per chain+token.
 * Returns `null` when the token can't answer `decimals()` (not an ERC-20, or
 * the request failed) — the caller falls back to raw base units. The null
 * result is NOT cached, so a later transfer of the same token retries.
 */
export function getTokenMeta(
  chainId: number,
  address: string,
): Promise<TokenMeta | null> {
  const key = cacheKey(chainId, address);
  const existing = cache.get(key);
  if (existing) return existing;

  const pending = load(chainId, address);
  cache.set(key, pending);
  // Self-heal: drop a failed read so the next event re-attempts it. A success
  // (decimals are immutable) stays cached for the life of the session.
  void pending.then((meta) => {
    if (meta === null) cache.delete(key);
  });
  return pending;
}

async function load(chainId: number, address: string): Promise<TokenMeta | null> {
  try {
    const info = isRpcOverridden(chainId)
      ? await fetchTokenMetaViaRpc(address, chainId)
      : await fetchTokenMeta(address, chainId);
    if (info.decimals === null) return null; // can't render a human amount; show raw.
    return { decimals: info.decimals, symbol: info.symbol ?? undefined };
  } catch {
    return null; // transient failure → not cached, retried on next event.
  }
}

/** Drop all memoized metadata — used by tests and on hard endpoint resets. */
export function resetTokenMeta(): void {
  cache.clear();
}
