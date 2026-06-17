import { useSearchParams } from "react-router-dom";
import { CHAINS, DEFAULT_CHAIN_ID } from "../../lib/chains";
import { useActiveChainId } from "../../lib/activeChain";
import { ChainGlyph } from "../ChainSelector";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Inline chain flipper for the network-health page — one pill per chain, writes
 * `?chainid=N` (the same param every chain-aware view reads). The default chain
 * drops the param so its URL stays canonical.
 */
export function ChainFlipper() {
  const active = useActiveChainId();
  const [params, setParams] = useSearchParams();

  const pick = (id: number) => {
    const next = new URLSearchParams(params);
    if (id === DEFAULT_CHAIN_ID) next.delete("chainid");
    else next.set("chainid", String(id));
    setParams(next);
  };

  return (
    <div className="flex gap-tight">
      {CHAINS.map((c) => {
        const on = c.id === active;
        return (
          <Tooltip key={c.id} label={`${c.name} · chain ${c.id}`}>
            <button
              type="button"
              onClick={() => pick(c.id)}
              className={`flex items-center gap-tight px-2 h-8 text-xs ${
                on ? "theme-text bs-b-accent" : "theme-text-muted hover:theme-text"
              }`}
            >
              <ChainGlyph chainId={c.id} />
              <span className="hidden sm:inline">{c.name}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
