import { useState } from "react";
import { useNetworkHealth } from "../hooks/useNetworkHealth";
import { useActiveChainId } from "../lib/activeChain";
import { chainById, chainSymbol } from "../lib/chains";
import { SummaryCards } from "../components/networkHealth/SummaryCards";
import { LensPanels } from "../components/networkHealth/LensPanels";
import { PositionHeatmap } from "../components/networkHealth/PositionHeatmap";
import { BlockTable } from "../components/networkHealth/BlockTable";

const STEP = 256;
const MAX = 2560;

export default function NetworkHealthPage() {
  const [limit, setLimit] = useState(STEP);
  const chainId = useActiveChainId();
  const chainName = chainById(chainId)?.name ?? `chain ${chainId}`;
  const symbol = chainSymbol(chainId);
  const { data, isPending, isError, error, isFetching } = useNetworkHealth(limit);

  return (
    <div className="space-y-section p-4">
      <header className="space-y-stack">
        <h1 className="text-xl theme-text">Network Health</h1>
        <p className="max-w-3xl text-sm theme-text-secondary">
          Who's getting prioritized in recent {chainName} blocks. Each tx's price
          splits into a burned base fee and a tip the validator keeps — shown
          here through both lenses, with how transaction types fall in mining
          order. Inversions flag blocks ordered on something other than fee; a
          signal to investigate, not proof of misbehavior.
        </p>
      </header>

      {data && !data.burnsBaseFee && (
        <div className="card p-2 text-xs theme-warning">
          Base fee is treated as retained (not burned) for this chain — the
          revenue lens shows full fees.
        </div>
      )}

      {isPending && (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-4">
          <div className="spinner mb-3" />
          <span className="text-sm theme-text-secondary">
            Loading {limit} blocks…
          </span>
        </div>
      )}

      {isError && (
        <div className="card p-4 theme-danger">
          Couldn't load network health:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {data && (
        <div className="space-y-section">
          <SummaryCards
            aggregate={data.aggregate}
            symbol={symbol}
            headBlock={data.headBlock}
          />
          <LensPanels
            aggregate={data.aggregate}
            symbol={symbol}
            burnsBaseFee={data.burnsBaseFee}
          />
          <PositionHeatmap
            histogram={data.aggregate.positionHistogram}
            avgPosition={data.aggregate.avgPositionByType}
          />
          <BlockTable blocks={data.blocks} />

          <div className="flex justify-center">
            {data.hasMore && limit < MAX ? (
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(MAX, l + STEP))}
                disabled={isFetching}
                className="px-4 py-2 text-sm theme-text bs hover:theme-accent disabled:opacity-50"
              >
                {isFetching ? "Loading…" : `Load ${STEP} more`}
              </button>
            ) : (
              <span className="text-xs theme-text-muted">
                {data.blocks.length} blocks loaded
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
