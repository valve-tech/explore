import type { WindowAggregate } from "../../api/networkHealth";
import { SplitBar } from "./SplitBar";
import { nativeAmount, pct, span } from "./format";

function StatCard({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-4 space-y-stack">
      <div className="text-xs uppercase tracking-wide theme-text-muted">
        {label}
      </div>
      <div className="text-2xl theme-text theme-mono">{value}</div>
      {children}
      {sub && <div className="text-xs theme-text-secondary">{sub}</div>}
    </div>
  );
}

export function SummaryCards({
  aggregate,
  symbol,
  headBlock,
}: {
  aggregate: WindowAggregate;
  symbol: string;
  headBlock: string;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-row">
      <StatCard
        label="Legacy gas share"
        value={pct(aggregate.legacyGasShare)}
        sub="type 0/1 vs ≥2, gas-weighted"
      >
        <SplitBar legacyFraction={aggregate.legacyGasShare} />
      </StatCard>

      <StatCard
        label="Fees burned"
        value={pct(aggregate.burnedShare)}
        sub={`${nativeAmount(aggregate.burned, symbol)} destroyed`}
      />

      <StatCard
        label="Priority inversions"
        value={pct(aggregate.priorityInversionRate)}
        sub="cross-sender pairs out of fee order"
      />

      <StatCard
        label="Window"
        value={`${aggregate.blocksAnalyzed} blk`}
        sub={`${span(aggregate.fromTimestamp, aggregate.toTimestamp)} · head #${headBlock}`}
      />
    </div>
  );
}
