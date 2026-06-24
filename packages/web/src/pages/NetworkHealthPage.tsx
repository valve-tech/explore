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
import { WindowSelector } from "../components/networkHealth/WindowSelector";
import { NetworkHealthSkeleton } from "../components/networkHealth/NetworkHealthSkeleton";
import { shareOf } from "../components/networkHealth/format";
import { DEFAULT_WINDOW } from "../lib/networkHealthWindow";

export default function NetworkHealthPage() {
  const [limit, setLimit] = useState(DEFAULT_WINDOW);
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
          <div className="flex items-baseline gap-row">
            <h1 className="text-xl theme-text">Network Health</h1>
            <span className="text-sm theme-text-muted">{chainName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-row">
            <WindowSelector value={limit} onChange={setLimit} busy={isFetching} />
            <ChainFlipper />
          </div>
        </div>
        <p className="text-sm theme-text-secondary">
          Fee priority across recent blocks — what users paid vs. what validators
          kept after the burn.{" "}
          <span className="theme-text-muted">Click a block for its fee ladder.</span>
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
            legacyBurnedFraction={
              data.burnsBaseFee
                ? shareOf(
                    data.aggregate.burnedByType.legacy,
                    data.aggregate.paidByType.legacy,
                  )
                : 0
            }
            modernBurnedFraction={
              data.burnsBaseFee
                ? shareOf(
                    data.aggregate.burnedByType.modern,
                    data.aggregate.paidByType.modern,
                  )
                : 0
            }
          />
          <MinersPanel
            miners={data.miners}
            symbol={symbol}
            totalBlocks={data.aggregate.blocksAnalyzed}
          />
          <BlockTable blocks={data.blocks} />

          <div className="flex justify-center text-xs theme-text-muted">
            {isFetching
              ? "Loading window…"
              : `${data.blocks.length.toLocaleString()} blocks · head #${Number(
                  data.headBlock,
                ).toLocaleString()}`}
          </div>
        </div>
      )}
    </div>
  );
}
