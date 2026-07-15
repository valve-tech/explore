import { UpstreamError, type VerifiedSource } from "./types.js";
import { cacheSource, getCachedSource } from "./cache.js";
import { fetchFromBlockScout } from "./blockscout.js";
import { fetchFromSourcify } from "./sourcify.js";
import { currentChainId } from "../chains/context.js";
import {
  createBreakerState,
  isCooledDown,
  recordFailure,
  recordSuccess,
  shouldSkip,
  type BreakerState,
} from "./breaker.js";

type UpstreamName = "sourcify" | "blockscout";

/**
 * One breaker per upstream PER CHAIN. The chain matters: each chain configures
 * its own `blockscoutBase` — 369 uses api.scan.pulsechain.com, 943 uses
 * api.scan.v4.testnet.pulsechain.com — so they are entirely different hosts
 * whose health is unrelated. A breaker keyed only by upstream name would let
 * one chain's dead Blockscout skip another chain's healthy one, and 943 has
 * `sourcifyEnabled: false`, meaning Blockscout is its ONLY verified-source.
 */
const breakers = new Map<string, BreakerState>();

/** In-flight background probes, keyed like `breakers`. At most one per key. */
const probing = new Set<string>();

const breakerKey = (name: UpstreamName): string => `${name}:${currentChainId()}`;

function breakerFor(key: string): BreakerState {
  let state = breakers.get(key);
  if (!state) {
    state = createBreakerState();
    breakers.set(key, state);
  }
  return state;
}

/** Test seam: reset breaker state between cases. */
export function resetBreakers(): void {
  breakers.clear();
  probing.clear();
}

/**
 * Re-probe a dead upstream OFF the request path.
 *
 * The point of the breaker is that no user ever waits on an upstream we
 * already know is dead. A synchronous half-open probe would undo that: one
 * unlucky request per cooldown would pay the full timeout, forever. Detaching
 * it means the cost is one slow request per PROCESS, not one per minute.
 *
 * The circuit stays open while this runs (openedAt is untouched until the
 * probe resolves), so concurrent requests keep skipping instead of piling up.
 */
function scheduleProbe(
  key: string,
  name: UpstreamName,
  address: string,
  fetcher: (address: string) => Promise<VerifiedSource | null>,
  state: BreakerState,
): void {
  if (probing.has(key)) return;
  probing.add(key);
  void (async () => {
    try {
      await fetcher(address);
      recordSuccess(state);
      console.warn(`[sourceCode] ${name} recovered — circuit closed`);
    } catch {
      // Still dead (or a non-Upstream throw — either way it did not answer).
      // Restart the cooldown from now.
      recordFailure(state, Date.now());
    } finally {
      probing.delete(key);
    }
  })();
}

/**
 * Run an upstream through its breaker.
 *
 * Returns `{ answered: true, result }` when the upstream gave a definitive
 * answer (source, or `null` for "not verified here"), and `{ answered: false }`
 * when it failed OR was skipped. A skipped upstream is reported exactly like a
 * failed one — it did NOT answer — which is what preserves the caller's rule
 * that a miss is only cached when every upstream truly answered.
 */
async function viaBreaker(
  name: UpstreamName,
  address: string,
  fetcher: (address: string) => Promise<VerifiedSource | null>,
): Promise<{ answered: boolean; result?: VerifiedSource | null }> {
  const key = breakerKey(name);
  const state = breakerFor(key);

  if (shouldSkip(state)) {
    if (isCooledDown(state, Date.now())) {
      scheduleProbe(key, name, address, fetcher, state);
    }
    return { answered: false };
  }

  try {
    const result = await fetcher(address);
    recordSuccess(state);
    return { answered: true, result };
  } catch (err) {
    if (!(err instanceof UpstreamError)) throw err;
    recordFailure(state, Date.now());
    console.warn(`[sourceCode] ${name} unavailable for ${address}: ${err.message}`);
    return { answered: false };
  }
}

/**
 * In-memory negative cache for addresses confirmed unverified. 10-min
 * TTL because contracts can get verified later — we don't want to lie
 * for too long. Lives at module scope so it survives across requests
 * inside one process.
 */
const NOT_FOUND_CACHE = new Map<string, number>();
const NOT_FOUND_TTL = 10 * 60 * 1000;

/**
 * Resolve verified source for an address. Walks: negative cache → DB
 * cache → Sourcify fetch → BlockScout fallback.
 *
 * Returns `null` only when at least one upstream **definitively answered
 * "not verified"** for this address — that result is safe to negative-cache.
 * Throws `UpstreamError` when both upstreams were transiently unavailable
 * (5xx / network / timeout) so we don't poison the cache during outages and
 * the route can surface a real 503 instead of a misleading 404.
 */
export async function getVerifiedSource(
  address: string,
): Promise<VerifiedSource | null> {
  const key = `${currentChainId()}:${address.toLowerCase()}`;

  const notFoundAt = NOT_FOUND_CACHE.get(key);
  if (notFoundAt && Date.now() - notFoundAt < NOT_FOUND_TTL) {
    return null;
  }

  const cached = await getCachedSource(address);
  if (cached) return cached;

  // Sourcify is the primary verification source (Blockscout instances mirror
  // their verifications there, so it covers Blockscout-verified contracts
  // too). Blockscout remains only as the fallback for chains Sourcify doesn't
  // index (e.g. the PulseChain testnet) — the one sanctioned Blockscout read.
  //
  // Track whether each upstream gave a definitive answer ("null" return) or
  // failed transiently (UpstreamError). We only poison the negative cache when
  // BOTH answered definitively — otherwise an outage cements as a 10-min lie.
  const sourcify = await viaBreaker("sourcify", address, fetchFromSourcify);
  const sourcifyAnswered = sourcify.answered;
  if (sourcify.result) {
    await cacheSource(sourcify.result).catch((err) => {
      console.error("[sourceCode] cache write failed:", err);
    });
    NOT_FOUND_CACHE.delete(key);
    return sourcify.result;
  }

  const blockscout = await viaBreaker("blockscout", address, fetchFromBlockScout);
  const blockscoutAnswered = blockscout.answered;
  if (blockscout.result) {
    await cacheSource(blockscout.result).catch((err) => {
      console.error("[sourceCode] cache write failed:", err);
    });
    NOT_FOUND_CACHE.delete(key);
    return blockscout.result;
  }

  if (blockscoutAnswered && sourcifyAnswered) {
    // Both upstreams definitively said "not here" — safe to cache the miss.
    NOT_FOUND_CACHE.set(key, Date.now());
    return null;
  }

  // At least one upstream was unavailable. Don't lie about "not verified" and
  // don't cement the answer; let the route raise a 503 the user can retry.
  throw new UpstreamError(
    blockscoutAnswered ? "sourcify" : sourcifyAnswered ? "blockscout" : "blockscout+sourcify",
    "verification upstreams unavailable",
  );
}
