import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTokenTransfers } from "../../../hooks/useTokenTransfers";

interface Props {
  address: string;
}

const BUCKETS = 48;

export function TransferChart({ address }: Props) {
  const {
    records,
    status,
    error,
    fromBlock,
    headBlock,
    window,
    loadingMore,
    loadMore,
    canLoadMore,
  } = useTokenTransfers(address);

  // Bucket transfer counts evenly across the loaded [fromBlock..headBlock]
  // block span. Block number is a linear proxy for time at ~10s/block, so
  // even bins read as even time bins.
  const { buckets, peak, total } = useMemo(() => {
    const empty = { buckets: new Array(BUCKETS).fill(0) as number[], peak: 0, total: 0 };
    if (fromBlock === null || headBlock === null || headBlock <= fromBlock) {
      return empty;
    }
    const span = headBlock - fromBlock;
    const counts = new Array(BUCKETS).fill(0) as number[];
    for (const r of records) {
      const idx = Math.min(
        BUCKETS - 1,
        Math.floor(((r.blockNumber - fromBlock) / span) * BUCKETS),
      );
      if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return { buckets: counts, peak: Math.max(...counts, 1), total: records.length };
  }, [records, fromBlock, headBlock]);

  return (
    <div className="rounded-lg bs p-5 theme-card-bg">
      <div className="flex items-center justify-between mb-stack">
        <span className="text-sm font-medium theme-text">
          Transfers
        </span>
        <span className="text-xs theme-text-muted">
          last {window}
        </span>
      </div>

      {status === "loading" && (
        <div className="h-[160px] flex items-center justify-center text-sm theme-text-muted">
          Loading transfers…
        </div>
      )}

      {status === "error" && (
        <div className="h-[160px] flex flex-col items-center justify-center gap-tight text-sm theme-danger">
          <Icon icon="heroicons:exclamation-triangle" className="w-5 h-5" />
          {error ?? "Failed to load transfers"}
        </div>
      )}

      {status === "success" && total === 0 && (
        <div className="h-[160px] flex items-center justify-center text-sm theme-text-muted">
          No transfers in this window.
        </div>
      )}

      {status === "success" && total > 0 && (
        <svg viewBox={`0 0 ${BUCKETS * 10} 100`} preserveAspectRatio="none" className="w-full h-[160px]">
          {buckets.map((count, i) => {
            const h = (count / peak) * 96;
            return (
              <rect
                key={i}
                x={i * 10 + 1}
                y={100 - h}
                width={8}
                height={h}
                fill="var(--color-accent)"
                opacity={count === 0 ? 0.15 : 0.85}
              >
                <title>{`${count} transfers`}</title>
              </rect>
            );
          })}
        </svg>
      )}

      {status === "success" && (
        <div className="mt-stack flex items-center gap-row text-xs theme-text-muted">
          <span>{total.toLocaleString()} transfers</span>
          {(canLoadMore || loadingMore) && (
            <button
              onClick={loadMore}
              disabled={loadingMore || !canLoadMore}
              className="flex items-center gap-tight hover:opacity-80 transition-opacity ml-auto disabled:opacity-50 theme-accent"
            >
              <Icon
                icon={loadingMore ? "heroicons:arrow-path" : "heroicons:plus"}
                className={`w-3 h-3 ${loadingMore ? "animate-spin" : ""}`}
              />
              {loadingMore ? "Loading…" : "Widen window"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
