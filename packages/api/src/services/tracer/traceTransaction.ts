import type { CallFrame, CallTraceResult } from "./types.js";
import { chainScopedTraceKey, getCachedTrace, setCachedTrace } from "./cache.js";
import { isDebugUnavailable, makeDebugRpc } from "./debugRpc.js";
import { traceViaAnvilFork } from "./anvilFallback.js";
import { dedupePromise } from "../../lib/dedupePromise.js";

/**
 * In-flight call-tree traces, keyed by (chain, lowercased tx hash). The Postgres
 * cache write inside `runTrace` is fire-and-forget, so concurrent
 * callers (e.g. /trace and /gas-profile firing in parallel from the
 * debugger view) would each miss the DB cache and issue a redundant
 * `debug_traceTransaction` RPC. Sharing one promise per hash collapses
 * those into a single trace; the entry is released on settle so the
 * next call hits the now-populated Postgres cache.
 *
 * The chain belongs in the key: without it, a 369 and a 943 request for the
 * same hash share one promise and the loser silently receives the winner's
 * chain's trace. See `chainScopedTraceKey`.
 */
const inFlight = new Map<string, Promise<CallTraceResult>>();

/**
 * Trace a mined transaction and return a callTracer-shaped tree. Walks
 * the sources in order: cache → live debug_ RPC → anvil-fork replay.
 * Cache hits short-circuit everything else.
 *
 * Concurrent calls for the same hash share one in-flight promise (see
 * `inFlight` above) so the RPC is only issued once per burst.
 *
 * `debugAvailable` on the result tells the caller whether the data came
 * from a debug-capable source; clients use this to gate features like
 * opcode-level inspection.
 */
export async function traceTransaction(
  hash: string,
): Promise<CallTraceResult> {
  return dedupePromise(inFlight, chainScopedTraceKey(hash), () =>
    runTrace(hash),
  );
}

async function runTrace(hash: string): Promise<CallTraceResult> {
  const cached = await getCachedTrace<CallFrame>(hash, "calltree");
  if (cached) {
    return { trace: cached, error: null, debugAvailable: true };
  }

  const tracerConfig = {
    tracer: "callTracer",
    tracerConfig: { withLog: false },
  };

  try {
    const rpcResult = await makeDebugRpc("debug_traceTransaction", [
      hash,
      tracerConfig,
    ]);

    if (rpcResult.error) {
      if (isDebugUnavailable(rpcResult.error)) {
        console.log(
          `[tracer] debug RPC unavailable, trying Anvil fork for ${hash}`,
        );
        const anvilResult = await traceViaAnvilFork(hash, tracerConfig);
        if (anvilResult) {
          const trace = anvilResult.result as CallFrame;
          void setCachedTrace(hash, "calltree", trace);
          return { trace, error: null, debugAvailable: true };
        }
        return {
          trace: null,
          error: "debug RPC unavailable and anvil-fork replay failed",
          debugAvailable: false,
        };
      }
      return {
        trace: null,
        error: `RPC error: ${rpcResult.error.message}`,
        debugAvailable: true,
      };
    }

    const trace = rpcResult.result as CallFrame;
    void setCachedTrace(hash, "calltree", trace);
    return { trace, error: null, debugAvailable: true };
  } catch {
    const anvilResult = await traceViaAnvilFork(hash, tracerConfig);
    if (anvilResult) {
      const trace = anvilResult.result as CallFrame;
      void setCachedTrace(hash, "calltree", trace);
      return { trace, error: null, debugAvailable: true };
    }
    return {
      trace: null,
      error: "debug RPC unavailable and anvil-fork replay failed",
      debugAvailable: false,
    };
  }
}
