import { Icon } from "@iconify/react";
import type { fetchLatestSummary } from "../../../api/latest";
import { formatBlockNum, formatGwei } from "./formatters";

type Summary = Awaited<ReturnType<typeof fetchLatestSummary>>;

/**
 * The four headline numbers.
 *
 * Tiles kept, styling corrected: `p-3` was off the p-2/p-4 scale, and the
 * value colour was an inline `style` where `theme-text` / `theme-text-muted`
 * already exist for exactly that pair.
 */
export function StatsRow({
  summary,
  loading,
}: {
  summary: Summary | undefined;
  loading: boolean;
}) {
  const finalizedLag = summary?.finalizedBlock.lagBlocks;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-row">
      <StatTile
        icon="heroicons:cube"
        label="Latest block"
        value={summary ? `#${formatBlockNum(summary.latestBlock.number)}` : "—"}
        sub={summary ? `${summary.latestBlock.transactionCount} txs` : ""}
        loading={loading}
      />
      <StatTile
        icon="heroicons:check-badge"
        label="Finalized"
        value={summary ? `#${formatBlockNum(summary.finalizedBlock.number)}` : "—"}
        sub={
          finalizedLag === undefined
            ? ""
            : `${finalizedLag} block${finalizedLag === 1 ? "" : "s"} behind`
        }
        loading={loading}
      />
      <StatTile
        icon="heroicons:fire"
        label="Base fee"
        value={summary ? formatGwei(summary.gasPrice.baseFeePerGas) : "—"}
        sub="gwei"
        loading={loading}
      />
      <StatTile
        icon="heroicons:bolt"
        label="Priority fee"
        value={summary ? formatGwei(summary.gasPrice.suggestedPriorityFee) : "—"}
        sub="gwei suggested"
        loading={loading}
      />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: string;
  label: string;
  value: string;
  sub: string;
  loading: boolean;
}) {
  return (
    <div className="p-2 sm:p-4 theme-card-bg shadow-[0_0_0_1px_var(--color-border-default)]">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest theme-text-muted">
        <Icon icon={icon} className="w-3 h-3 shrink-0" aria-hidden="true" />
        {label}
      </div>
      <div
        className={`text-base theme-mono font-semibold tabular-nums mt-1 break-all ${
          loading ? "theme-text-muted" : "theme-text"
        }`}
      >
        {loading ? "loading…" : value}
      </div>
      {sub !== "" && <div className="text-xs mt-0.5 theme-text-muted">{sub}</div>}
    </div>
  );
}
