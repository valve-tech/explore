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
function forChain(action: PaletteAction, chainId: number): PaletteAction {
  const name = chainById(chainId)?.name ?? `Chain ${chainId}`;
  // DEFAULT_CHAIN_ID omits the param (byte-identical to the single-chain era,
  // matching how api/chainScope.ts scopes requests); other chains carry it.
  const to =
    chainId === DEFAULT_CHAIN_ID
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
  return resolution.matches.flatMap((m) =>
    parsed.actions.map((a) => forChain(a, m.chainId)),
  );
}
