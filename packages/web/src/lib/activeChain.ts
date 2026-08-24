import { useLocation, useSearchParams } from "react-router-dom";
import { DEFAULT_CHAIN_ID } from "./chains";
import { parseChainScope, readLocationScope, type ChainScope } from "./chainScope";

/**
 * The full chain scope of the current route: one chain, or every chain.
 *
 * Only three routes render an "all" scope — /address/:addr, /token/:addr and
 * /block/:number. Everything else uses `useActiveChainId`, which collapses
 * "all" to the default chain and so keeps its pre-multichain behaviour exactly.
 */
export function useChainScope(): ChainScope {
  const location = useLocation();
  const [params] = useSearchParams();
  return parseChainScope(location.pathname, `?${params.toString()}`);
}

/**
 * The chain a route is scoped to, defaulting to PulseChain. Signature unchanged
 * from the `?chainid=N`-only era on purpose: ~40 call sites read this, and the
 * routing change must not reach any of them.
 */
export function useActiveChainId(): number {
  const scope = useChainScope();
  return scope.kind === "one" ? scope.chainId : DEFAULT_CHAIN_ID;
}

/**
 * Non-reactive read of the same scope, for fetch-layer code that runs outside a
 * component (api/source.ts, contractMeta.ts). Handles both router shapes — see
 * `readLocationScope`.
 */
export function getActiveChainId(): number {
  const scope = readLocationScope();
  return scope.kind === "one" ? scope.chainId : DEFAULT_CHAIN_ID;
}
