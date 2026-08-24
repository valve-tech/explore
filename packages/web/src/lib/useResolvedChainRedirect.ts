import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { resolveEntity } from "../api/resolve";
import { DEFAULT_CHAIN_ID } from "./chains";
import { useChainScope } from "./activeChain";

/**
 * Point a chain-less entity deep link at the chain the entity actually lives on.
 *
 * Chain selection lives entirely in `?chainid=N` (see `activeChain.ts`), and
 * `scoped()` omits the param for the default chain — so a shared or bookmarked
 * `/debugger/0xabc` carries no chain at all and resolves to PulseChain (369).
 * For a transaction mined on any other chain that is simply wrong: every fetch
 * goes to 369, where the hash doesn't exist, and the page reports no data for a
 * transaction that traces perfectly one chain over. That is the whole failure
 * behind `/debugger/<a 943 tx>` — nothing about the trace pipeline was broken.
 *
 * The pasted-hash paths (Landing search, ⌘K palette) already avoid this by
 * asking `/api/resolve` which chain a hash is on and navigating with the right
 * `chainid`. Deep links never went through that step. This hook applies the same
 * resolve to the URL itself.
 *
 * Two deliberate limits:
 *
 *   - It runs ONLY when the URL names no chain, by EITHER mechanism: a path
 *     prefix (`/eip155/369/…`) or a well-formed `?chainid=369` query param.
 *     Either one is the caller's stated scope; if the tx isn't there, the
 *     honest answer is "not found on PulseChain", not a silent hop to another
 *     chain. This also makes a redirect loop impossible — once either form
 *     names a chain, the hook is disabled. Checking the query param alone used
 *     to miss the path form entirely: a `/eip155/943/tx/0xabc` load fanned a
 *     resolve out across every chain, then wrote `?chainid=943` on top of a
 *     path that already said 943 — the chain named twice in one URL.
 *     An EMPTY or malformed `chainid` (`?chainid=`, `?chainid=abc`) is not a
 *     stated scope — `parseChainScope` maps it to "all", same as an absent
 *     param — so the hook resolves it and writes a real chain. That is a
 *     deliberate choice, not an oversight: a real chain id is more useful than
 *     silently defaulting to PulseChain, and it still terminates cleanly,
 *     because writing the chain is what disables the hook on the next render.
 *   - It redirects only when the entity is NOT on the default chain. If it's on
 *     369 (alone or among others) the URL stays clean and param-free, matching
 *     `scoped()`.
 *
 * Third deliberate limit, added with the all-chain address view:
 *
 *   - It never fires when the caller passes `kind: "skip"`. An address is the
 *     original case: a tx hash lives on exactly one chain, so resolving it is
 *     answering a real question, but an address is valid on every chain, so
 *     "which one?" has no correct answer — `/address/0x…` renders every chain
 *     instead, and redirecting it would replace a complete answer with an
 *     arbitrary one. A chain-less block NUMBER is the same shape of case: it
 *     exists on every chain past that height, so there is equally no single
 *     right chain to resolve to.
 *
 * Callers should hold their own fetches until this reports `"settled"`, so the
 * heavy per-chain requests fire once, against the right chain.
 */
export type ChainRedirectState =
  /** No query to resolve, or the URL already names a chain. */
  | "idle"
  /** A resolve is in flight; the correct chain isn't known yet. */
  | "resolving"
  /** Resolve finished (or failed) — the URL now names the best chain we know. */
  | "settled";

export function useResolvedChainRedirect(
  query: string | null,
  kind: "entity" | "skip" = "entity",
): ChainRedirectState {
  const [params, setParams] = useSearchParams();
  // `useChainScope` already reads BOTH forms of a stated chain — the path
  // prefix and the legacy query param — and returns "one" for either. Reading
  // only `params.has("chainid")` here would miss the path form, which is
  // exactly the bug this line fixes: a `/eip155/943/…` load looked chain-less
  // to a query-only check and got resolved (and re-labelled) anyway.
  const urlNamesChain = useChainScope().kind === "one";
  const enabled = !!query && !urlNamesChain && kind !== "skip";

  const resolve = useQuery({
    queryKey: ["resolve-chain", query],
    queryFn: () => resolveEntity(query!),
    enabled,
    // A hash's chain is immutable, so this is cacheable forever — and the
    // persisted client means a revisit skips the probe entirely.
    staleTime: Infinity,
    gcTime: Infinity,
    // A failed resolve must not strand the caller in "resolving" behind
    // retry backoff; fall through to the default chain and let the entity
    // fetch report the real error.
    retry: false,
  });

  const matches = resolve.data?.matches;

  // A tx hash realistically matches one chain; for an address with presence on
  // several, the lowest id is the stable, reproducible pick (`resolveEntity`
  // already sorts ascending).
  const target =
    enabled && matches?.length && !matches.some((m) => m.chainId === DEFAULT_CHAIN_ID)
      ? matches[0]!.chainId
      : null;

  useEffect(() => {
    if (target === null) return;
    const next = new URLSearchParams(params);
    next.set("chainid", String(target));
    setParams(next, { replace: true });
  }, [target, params, setParams]);

  if (!enabled) return "idle";
  // NOT just `resolve.isLoading`. The redirect lands in an effect, one render
  // AFTER the resolve resolves — so reporting "settled" the moment the data
  // arrives hands callers a render where the answer is known but the URL still
  // says PulseChain, and they spend their fetches on the wrong chain anyway.
  // Stay "resolving" until the redirect has actually been applied, at which
  // point `urlNamesChain` flips and this hook reports "idle".
  return resolve.isLoading || target !== null ? "resolving" : "settled";
}
