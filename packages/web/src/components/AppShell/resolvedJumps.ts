import { chainById, DEFAULT_CHAIN_ID } from "../../lib/chains";
import type { ResolveMatch } from "../../api/resolve";
import type { PaletteAction, Parsed } from "./parseInput";

/**
 * Cross-chain jump actions for the ⌘K palette.
 *
 * The palette has no chain selector, so a pasted tx hash / address is resolved
 * across every registered chain (via `/api/resolve`). The resulting jump
 * actions target the chain(s) the entity actually exists on — each carrying
 * `?chainid=N` and labelled with the chain — instead of silently defaulting to
 * one chain. While the probe is in flight, or when nothing was found, it falls
 * back to the parser's bare actions so a row is always openable (degrading to
 * the pre-cross-chain behavior).
 */

export type ResolutionStatus = "idle" | "loading" | "done";

export interface Resolution {
  status: ResolutionStatus;
  matches: ResolveMatch[];
}

/** Append `?chainid=N` to an action's route and annotate it with the chain. */
function forChain(
  action: PaletteAction,
  chainId: number,
  explicit = false,
): PaletteAction {
  const name = chainById(chainId)?.name ?? `Chain ${chainId}`;
  // DEFAULT_CHAIN_ID omits the param for a tx (byte-identical to the
  // single-chain era). An address must always carry it: its bare route is the
  // every-chain page, not the default chain.
  const to =
    chainId === DEFAULT_CHAIN_ID && !explicit
      ? action.to
      : action.to + (action.to.includes("?") ? "&" : "?") + `chainid=${chainId}`;
  return { ...action, to, detail: `on ${name} — ${action.detail}` };
}

export function resolvedActions(
  parsed: Parsed,
  resolution?: Resolution,
): PaletteAction[] {
  if (parsed.kind === "unknown") return [];
  // Only tx/address are located cross-chain; blocks/selectors keep their route.
  if (parsed.kind !== "tx" && parsed.kind !== "address") return parsed.actions;
  if (
    !resolution ||
    resolution.status !== "done" ||
    resolution.matches.length === 0
  ) {
    return parsed.actions; // resolving, or found nowhere → default-chain fallback
  }
  if (parsed.kind === "address") {
    // An address is valid on every chain. The bare row opens the page that
    // shows every chain, so it comes first and Enter never picks chain 1.
    return [
      // Only the Explorer page has an every-chain form; storage is per chain.
      ...parsed.actions
        .filter((a) => a.to.startsWith("/address/"))
        .map((a) => ({ ...a, detail: `on every chain — ${a.detail}` })),
      ...resolution.matches.flatMap((m) =>
        parsed.actions.map((a) => forChain(a, m.chainId, true)),
      ),
    ];
  }
  return resolution.matches.flatMap((m) =>
    parsed.actions.map((a) => forChain(a, m.chainId)),
  );
}
