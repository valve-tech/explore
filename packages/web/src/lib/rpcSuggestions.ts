import { collectRpcs } from "@valve-tech/rpc-collector";
import { VALVE_PUBLIC_RPC } from "./rpcDefaults";

/**
 * Public RPC endpoints a user could switch to, sourced from
 * `@valve-tech/rpc-collector` — the chainlist dataset compiled into the
 * package at build time, so nothing is fetched at runtime.
 *
 * SEPARATE MODULE ON PURPOSE. The collector ships a ~272 KB vendored dataset.
 * Importing it from `rpcDefaults.ts` (which `wagmi.ts` needs) pulled the whole
 * thing into the app's core chunk and took it from ~31 KB to ~55 KB gzipped,
 * for a list only the settings page ever shows. Keep this module out of any
 * import chain that starts at `wagmi.ts` or `main.tsx`.
 */

/** How a provider describes its own logging. Straight from chainlist. */
export type RpcTracking = "none" | "limited" | "unspecified" | "unknown" | "yes";

export interface RpcChoice {
  url: string;
  /** The provider's OWN claim about logging — not something we verified. */
  tracking: RpcTracking;
  /** True for Valve's endpoints: ours, and probed as archive. */
  isValve: boolean;
}

/**
 * Valve's endpoint first, then every chainlist endpoint whose provider states
 * it does not log.
 *
 * `allowedTracking: ["none"]` is deliberately strict. `collectRpcs` already
 * orders privacy-first, so dropping the filter would append providers that
 * openly log — fine as data, wrong as a suggestion.
 */
export function rpcAlternatives(chainId: number, limit = 6): RpcChoice[] {
  const valve = VALVE_PUBLIC_RPC[chainId];
  const choices: RpcChoice[] = valve
    ? [{ url: valve, tracking: "none", isValve: true }]
    : [];

  let collected: { url: string; tracking?: string }[] = [];
  try {
    collected = collectRpcs({
      chainId,
      allowedTracking: ["none"],
      protocol: "http",
      limit,
    });
  } catch {
    // An unknown chain throws. A missing suggestion list is not worth
    // breaking the settings page over — Valve's own entry still stands.
    collected = [];
  }

  const seen = new Set(choices.map((c) => c.url));
  for (const endpoint of collected) {
    if (seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    choices.push({
      url: endpoint.url,
      tracking: (endpoint.tracking as RpcTracking) ?? "unknown",
      isValve: false,
    });
  }
  return choices;
}
