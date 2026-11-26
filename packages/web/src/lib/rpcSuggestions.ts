import curated from "./rpcCurated.json";
import { VALVE_PUBLIC_RPC } from "./rpcDefaults";

/**
 * Public RPC endpoints a user could switch to: a short list we choose and
 * re-check, in `rpcCurated.json`.
 *
 * It replaced the chainlist dataset (`@valve-tech/rpc-collector`) on
 * 2026-11-26. Of 40 chainlist candidates for Ethereum, more than half were
 * dead, rate-limited or wanted a key, and two PulseChain hosts it marked
 * "no logs" do log. Each endpoint here answered on that date with the right
 * chain id, at the chain head, and with browser access (CORS) allowed.
 * Endpoints that serve history (state at block 1) come first.
 *
 * Re-check the list with `npm run check:rpcs --workspace=packages/web`.
 * We make no claim about any provider's logging.
 */

/** The date the list in `rpcCurated.json` last passed `check:rpcs`. */
export const RPC_LIST_CHECKED: string = curated.checked;

export interface RpcChoice {
  url: string;
  /** True for Valve's endpoints: ours, and probed as archive. */
  isValve: boolean;
}

const ENDPOINTS: Readonly<Record<string, readonly string[]>> = curated.endpoints;

/** Valve's endpoint first, then the curated endpoints for the chain. */
export function rpcAlternatives(chainId: number, limit = 6): RpcChoice[] {
  const valve = VALVE_PUBLIC_RPC[chainId];
  const choices: RpcChoice[] = valve ? [{ url: valve, isValve: true }] : [];
  for (const url of (ENDPOINTS[String(chainId)] ?? []).slice(0, limit)) {
    if (url !== valve) choices.push({ url, isValve: false });
  }
  return choices;
}
