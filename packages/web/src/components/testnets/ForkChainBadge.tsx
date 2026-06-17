import { chainById } from "../../lib/chains";
import { ChainGlyph } from "../ChainSelector";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Small chain pill for a fork — logo glyph + chain name. Reads the launch-set
 * registry in lib/chains.ts; falls back to a numeric `Chain N` label for chain
 * ids the UI registry doesn't know about (and to "PulseChain" for legacy forks
 * created before the backend started echoing `chainId`).
 */
export function ForkChainBadge({ chainId }: { chainId?: number }) {
  const id = chainId ?? 369;
  const info = chainById(id);
  const label = info?.name ?? `Chain ${id}`;

  return (
    <Tooltip label={`Forked from ${label} (chain ${id})`}>
      <span className="inline-flex items-center gap-tight text-xs px-2 py-0.5 rounded-full theme-tertiary-bg theme-text-secondary">
        <ChainGlyph chainId={id} />
        {label}
      </span>
    </Tooltip>
  );
}
