import { caip2ToChainId, chainCaip2 } from "./chains";

/**
 * The single reader for "what chain is this page about?".
 *
 * Chain scope used to live only in `?chainid=N`, which made it a second-class
 * citizen: it did not compose with routing, and it had no room for a non-EVM
 * chain. Scope now lives in the path as two CAIP-2 segments —
 * `/eip155/369/tx/0x…` — and the query parameter survives only as a legacy
 * form that gets rewritten once.
 *
 * Resolution order, highest first:
 *   1. the path prefix
 *   2. the `?chainid=N` query parameter (legacy)
 *   3. neither → "all"
 *
 * "All" is a real scope for exactly three routes — /address/:addr,
 * /token/:addr, /block/:number — which render every chain. Every other route
 * collapses "all" to DEFAULT_CHAIN_ID, which is what shipped before. That
 * collapse happens in `useActiveChainId`, not here, so this module stays a
 * pure description of the URL.
 */
export type ChainScope =
  | { kind: "one"; chainId: number }
  | { kind: "all" };

const ALL: ChainScope = { kind: "all" };

/** Chain id from the two leading path segments, or undefined. */
function scopeFromPath(pathname: string): number | undefined {
  const [, namespace, reference] = pathname.split("/");
  if (!namespace || !reference) return undefined;
  return caip2ToChainId(namespace, reference);
}

/**
 * Chain id from the legacy `?chainid=N`, or undefined for absent/malformed
 * values. It deliberately does NOT check the registry.
 *
 * An unregistered id passes through so `scoped()` forwards it and the backend
 * rejects it loudly. Rejecting it here would return "all", which
 * `useActiveChainId` collapses to the default chain — so the page would
 * quietly render PulseChain data for a chain the caller never asked for. A loud
 * failure beats a silent wrong answer.
 *
 * The path form needs no such allowance: ChainScopedRoutes validates the
 * CAIP-2 pair and renders "Unsupported chain" before any fetch runs.
 */
function scopeFromQuery(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("chainid");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function parseChainScope(pathname: string, search: string): ChainScope {
  const fromPath = scopeFromPath(pathname);
  if (fromPath !== undefined) return { kind: "one", chainId: fromPath };
  const fromQuery = scopeFromQuery(search);
  if (fromQuery !== undefined) return { kind: "one", chainId: fromQuery };
  return ALL;
}

/**
 * The route prefix for a chain — `/eip155/369`. Empty string for a chain we do
 * not serve, so a caller concatenating it produces the bare path rather than a
 * route that resolves to nothing.
 */
export function chainRoutePrefix(chainId: number): string {
  const pair = chainCaip2(chainId);
  return pair ? `/${pair.namespace}/${pair.reference}` : "";
}

/**
 * Remove a valid chain prefix from a path; leave anything else untouched.
 *
 * `ExplorerPanel` reads `location.pathname` to pick which entity view to
 * show (`/tx/…`, `/block/…`, `/address/…`, `/token/…`). Under the
 * chain-scoped mount that path carries a two-segment prefix
 * (`/eip155/369/tx/0x…`), so the view-detection checks must see the path
 * WITHOUT the prefix or they never match. Strip here, once, rather than
 * teaching every consumer about the prefix.
 *
 * An unregistered or unknown namespace is not a valid prefix — `scopeFromPath`
 * already returns undefined for it, so the path passes through untouched
 * rather than losing two segments that were never a chain scope.
 */
export function stripChainPrefix(pathname: string): string {
  if (scopeFromPath(pathname) === undefined) return pathname;
  const rest = pathname.split("/").slice(3).join("/");
  return `/${rest}`;
}

/**
 * Non-reactive scope read for fetch-layer code that runs outside a component.
 * Handles both router shapes: BrowserRouter keeps the path in `pathname` and
 * the query in `search`; the IPFS HashRouter build carries BOTH inside the
 * hash (`/#/eip155/369/tx/0x…?chainid=N`).
 *
 * Components should prefer `useChainScope` — it re-renders on navigation and
 * feeds query keys. This getter only reflects the URL at call time.
 */
export function readLocationScope(): ChainScope {
  if (typeof window === "undefined") return ALL;
  const hash = window.location.hash.startsWith("#/") ? window.location.hash.slice(1) : "";
  if (hash) {
    const [path = "", query = ""] = hash.split("?");
    return parseChainScope(path, query ? `?${query}` : "");
  }
  return parseChainScope(window.location.pathname, window.location.search);
}
