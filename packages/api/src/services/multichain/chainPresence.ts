import type { Address, PublicClient } from "viem";
import { getRpcClient } from "../chains/clients.js";
import { listChains } from "../chains/registry.js";

/**
 * Cross-chain presence probe — "which chains is this address worth opening on?".
 *
 * An address is valid on every EVM chain, so existence proves nothing. Presence
 * means bytecode, a non-zero nonce, or a non-zero balance. This is the same
 * question `services/resolve/resolveEntity.ts` asks per chain; the difference is
 * that this one keeps the answer, caches it, and reports failures instead of
 * folding them into "not here".
 *
 * The fan-out is the cheap half of the multichain address page: three reads per
 * chain, batched by viem. Only chains that come back present pay for the
 * expensive activity fetch. Prod has 429'd on Ethereum before (see the comment
 * in chains/defaults.ts), so this budget is a requirement, not an optimisation.
 *
 * Deps are injected so the fan-out is unit-testable without any live RPC.
 */

export interface ChainPresence {
  chainId: number;
  /** Native balance in wei, serialized — BigInt never reaches JSON. */
  balance: string;
  nonce: number;
  isContract: boolean;
  /** Set when the probe failed. Means "unknown", NOT "absent". */
  error?: true;
}

export interface PresenceDeps {
  chainIds: () => number[];
  getClient: (chainId: number) => PublicClient;
  timeoutMs: number;
}

const defaultDeps: PresenceDeps = {
  chainIds: () => listChains().map((c) => c.chainId),
  getClient: getRpcClient,
  timeoutMs: 7_000,
};

/** Presence changes slowly; a short TTL collapses repeat page loads. */
const TTL_MS = 60_000;

interface CacheEntry {
  value: ChainPresence;
  expiresAt: number;
}

/**
 * Cache key is `${chainId}|${address}`. The chain id is NOT optional: two
 * production bugs (migrations 009 and 012) came from caching chain data under a
 * key that omitted it, which served one chain's answer for every chain.
 */
const cache = new Map<string, CacheEntry>();

export function clearPresenceCache(): void {
  cache.clear();
}

/** A chain is worth showing when the address has code, funds, or history. */
export function hasPresence(p: ChainPresence): boolean {
  if (p.error) return false;
  return p.isContract || p.nonce > 0 || p.balance !== "0";
}

export async function getChainPresence(
  address: string,
  chainIds?: number[],
  deps: PresenceDeps = defaultDeps,
): Promise<ChainPresence[]> {
  const addr = address.trim().toLowerCase();
  const ids = (chainIds ?? deps.chainIds()).slice().sort((a, b) => a - b);

  return Promise.all(ids.map((chainId) => probeOne(addr, chainId, deps)));
}

async function probeOne(
  address: string,
  chainId: number,
  deps: PresenceDeps,
): Promise<ChainPresence> {
  const key = `${chainId}|${address}`;
  const hit = cache.get(key);
  // The cache is a module-level singleton, so two independent callers (a
  // direct getChainPresence() call and resolveEntity's probeAddress) read and
  // write the same key. TTL bookkeeping always uses the real wall clock
  // (Date.now()), never an injected one: shared state needs one source of
  // truth for time, or one caller's fresh entry looks expired to the other.
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await withTimeout(read(address, chainId, deps), deps.timeoutMs).catch(
    (): ChainPresence => ({
      chainId,
      balance: "0",
      nonce: 0,
      isContract: false,
      error: true,
    }),
  );

  // Never pin a failure. An unreachable RPC recovers; a cached "error" would
  // outlive the outage and read as a fact.
  if (!value.error) {
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }
  return value;
}

async function read(
  address: string,
  chainId: number,
  deps: PresenceDeps,
): Promise<ChainPresence> {
  const client = deps.getClient(chainId);
  const [code, balance, nonce] = await Promise.all([
    client.getCode({ address: address as Address }),
    client.getBalance({ address: address as Address }),
    client.getTransactionCount({ address: address as Address }),
  ]);
  return {
    chainId,
    balance: String(balance ?? 0n),
    nonce: Number(nonce ?? 0),
    isContract: !!code && code !== "0x",
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out")), ms),
    ),
  ]);
}
