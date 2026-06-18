import { useState } from "react";
import { useNetworkHealth } from "../hooks/useNetworkHealth";
import { useActiveChainId } from "../lib/activeChain";
import { chainById, chainSymbol } from "../lib/chains";
import { SummaryCards } from "../components/networkHealth/SummaryCards";
import { LensPanels } from "../components/networkHealth/LensPanels";
import { PositionHeatmap } from "../components/networkHealth/PositionHeatmap";
import { MinersPanel } from "../components/networkHealth/MinersPanel";
import { BlockTable } from "../components/networkHealth/BlockTable";
import { ChainFlipper } from "../components/networkHealth/ChainFlipper";
import { NetworkHealthSkeleton } from "../components/networkHealth/NetworkHealthSkeleton";

const INITIAL = 64; // cheap cold warm; matches the API's INITIAL_WINDOW
const STEP = 256; // load-more increment
const MAX = 2560;

export default function NetworkHealthPage() {
  const [limit, setLimit] = useState(INITIAL);
  const chainId = useActiveChainId();
  const chainName = chainById(chainId)?.name ?? `chain ${chainId}`;
  const symbol = chainSymbol(chainId);
  const { data, isPending, isError, error, isFetching, refetch } =
    useNetworkHealth(limit);

  // keepPreviousData holds the prior chain's data while the new chain loads, so
  // `isPending` is false on a chain switch and the old numbers would otherwise
  // render next to the new chain's symbol. Treat data for a different chain as
  // "not loaded yet" and show the skeleton — never stale numbers. (A load-more
  // or background refetch keeps the same chainId, so it stays on the data view.)
  const stale = !!data && data.chainId !== chainId;
  const showSkeleton = (isPending || stale) && !isError;

  return (
    <div className="space-y-section p-4">
      <header className="space-y-stack">
        <div className="flex flex-wrap items-center justify-between gap-row">
          <h1 className="text-xl theme-text">Network Health</h1>
          <ChainFlipper />
        </div>
        <p className="max-w-3xl text-sm theme-text-secondary">
          Who's getting prioritized in recent {chainName} blocks. Each tx's price
          splits into a burned base fee and a tip the validator keeps — shown
          here through both lenses, with how transaction types fall in mining
          order. Inversions flag blocks ordered on something other than fee; a
          signal to investigate, not proof of misbehavior.{" "}
          <span className="theme-text-muted">
            Click any block below to open its fee ladder.
          </span>
        </p>
      </header>

      {data && !stale && !data.burnsBaseFee && (
        <div className="card p-2 text-xs theme-warning">
          Base fee is treated as retained (not burned) for this chain — the
          revenue lens shows full fees.
        </div>
      )}

      {showSkeleton && (
        <div className="space-y-stack">
          <NetworkHealthSkeleton />
          {isPending && (
            <p className="text-center text-xs theme-text-muted">
              First load warms the cache; later loads are instant.
            </p>
          )}
        </div>
      )}

      {isError && (
        <div className="card p-4 space-y-stack">
          <div className="text-sm theme-danger">
            Couldn't load network health:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="px-4 py-2 text-sm theme-text bs hover:theme-accent disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {data && !stale && (
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
          <MinersPanel
            miners={data.miners}
            symbol={symbol}
            totalBlocks={data.aggregate.blocksAnalyzed}
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
