import { useLocation, useNavigate } from "react-router-dom";
import { CHAINS } from "../../lib/chains";
import { useActiveChainId } from "../../lib/activeChain";
import { chainRoutePrefix, stripChainPrefix } from "../../lib/chainScope";
import { ChainGlyph } from "../ChainSelector";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Inline chain flipper for the network-health page — one pill per chain,
 * writes the chain into the path prefix, like every other chain writer on
 * this branch. `chainRoutePrefix` returns "" for a chain we do not serve, so
 * the prefix drops rather than pointing at a route that resolves to nothing.
 */
export function ChainFlipper() {
  const active = useActiveChainId();
  const location = useLocation();
  const navigate = useNavigate();

  const pick = (id: number) => {
    navigate(`${chainRoutePrefix(id)}${stripChainPrefix(location.pathname)}${location.search}`);
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
