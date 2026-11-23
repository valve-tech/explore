import { redactSecrets } from "../../lib/redact.js";
import type {
  CallFrame,
  CallTraceResult,
  TraceCallParams,
} from "./types.js";
import {
  UNAVAILABLE_MSG,
  isDebugUnavailable,
  makeDebugRpc,
} from "./debugRpc.js";

/**
 * Trace a simulated call (not yet on-chain) via `debug_traceCall`. No
 * caching — the call hasn't happened, the result depends on the current
 * state, and the input set is essentially unbounded.
 *
 * No anvil-fork fallback either — fork replay requires a tx hash to fork
 * from. If debug RPC isn't available, this just returns an explanatory
 * error.
 */
export async function traceCall(
  params: TraceCallParams,
): Promise<CallTraceResult> {
  try {
    const txObj: Record<string, string> = {};
    if (params.from) txObj.from = params.from;
    if (params.to) txObj.to = params.to;
    if (params.value) txObj.value = params.value;
    if (params.data) txObj.data = params.data;
    if (params.gas) txObj.gas = params.gas;

    const rpcResult = await makeDebugRpc("debug_traceCall", [
      txObj,
      "latest",
      { tracer: "callTracer", tracerConfig: { withLog: false } },
    ]);

    if (rpcResult.error) {
      if (isDebugUnavailable(rpcResult.error)) {
        return { trace: null, error: UNAVAILABLE_MSG, debugAvailable: false };
      }
      return {
        trace: null,
        error: `RPC error: ${rpcResult.error.message}`,
        debugAvailable: true,
      };
    }

    return {
      trace: rpcResult.result as CallFrame,
      error: null,
      debugAvailable: true,
    };
  } catch (err) {
    // viem's message carries the upstream URL, key included. This is public.
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    return {
      trace: null,
      error: `Failed to trace call: ${message}`,
      debugAvailable: false,
    };
  }
}
