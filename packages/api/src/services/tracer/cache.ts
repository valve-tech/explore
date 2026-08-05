import { pool } from "../pool.js";
import { currentChainId } from "../chains/context.js";

/**
 * Mined-tx traces are deterministic and immutable, so the result of any
 * `debug_traceTransaction` / `callTracer` / struct-log run can be cached
 * forever on the (chain_id, tx_hash, trace_type) tuple. Reads are best-effort —
 * a DB hiccup returns null and the caller falls through to a fresh RPC.
 *
 * The chain is resolved HERE, from the request-scoped chain context, rather than
 * being threaded through every call site. That is deliberate: the original bug
 * was a key that omitted the chain entirely (see migration 012), and the same
 * class of bug returns the moment one of the five call sites forgets to pass a
 * chainId it was handed. Reading it centrally makes the chain impossible to
 * omit, and matches how `debugRpc.ts` resolves the endpoint for the same
 * request. Outside a request the context resolves to the default chain, so
 * background callers behave exactly as before.
 */
/**
 * Chain-scoped key for the tracer's IN-PROCESS caches — the `inFlight` dedupe
 * map in `traceTransaction.ts` and the heavy-detail LRU in `opcodeDetail.ts`.
 *
 * Those two were keyed by tx hash alone, the same defect migration 012 fixes in
 * Postgres and with the same consequence: two requests for one hash on
 * different chains collapsed onto a single promise / LRU entry, so whichever
 * chain arrived first decided what BOTH chains got back. A tx hash is not a
 * cache identity on its own — only (chain, hash) is.
 */
export function chainScopedTraceKey(txHash: string, suffix?: string): string {
  const base = `${currentChainId()}:${txHash.toLowerCase()}`;
  return suffix === undefined ? base : `${base}:${suffix}`;
}

export async function getCachedTrace<T>(
  txHash: string,
  traceType: string,
): Promise<T | null> {
  try {
    const { rows } = await pool.query<{ result: T }>(
      "SELECT result FROM trace_cache WHERE chain_id = $1 AND tx_hash = $2 AND trace_type = $3",
      [currentChainId(), txHash.toLowerCase(), traceType],
    );
    return rows[0]?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Track in-flight cache writes so a graceful shutdown can await them.
 * Trace responses don't wait on the cache write (see the `void
 * setCachedTrace(...)` call sites in the public-API files) — that's
 * intentional to avoid adding DB latency to the response. The tradeoff is
 * that a SIGTERM during a write would drop the cache entry; this Set lets
 * the shutdown handler call `awaitPendingCacheWrites()` to drain pending
 * writes before exit.
 */
const pendingCacheWrites = new Set<Promise<void>>();

/** Resolve once every in-flight cache write has settled (succeeded or failed). */
export async function awaitPendingCacheWrites(): Promise<void> {
  if (pendingCacheWrites.size === 0) return;
  await Promise.allSettled([...pendingCacheWrites]);
}

export async function setCachedTrace(
  txHash: string,
  traceType: string,
  result: unknown,
): Promise<void> {
  const write = (async () => {
    try {
      await pool.query(
        `INSERT INTO trace_cache (chain_id, tx_hash, trace_type, result)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (chain_id, tx_hash, trace_type)
           DO UPDATE SET result = $4::jsonb, created_at = NOW()`,
        [
          currentChainId(),
          txHash.toLowerCase(),
          traceType,
          JSON.stringify(result),
        ],
      );
    } catch (err) {
      console.error("[tracer] cache write failed:", err);
    }
  })();
  pendingCacheWrites.add(write);
  write.finally(() => pendingCacheWrites.delete(write));
  return write;
}
