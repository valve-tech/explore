import type { WindowAggregate } from "../../api/networkHealth";
import { SplitBar } from "./SplitBar";
import { InfoTip, Eq } from "./InfoTip";
import { nativeAmount, pct, span } from "./format";

function StatCard({
  label,
  value,
  sub,
  info,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  info?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-4 space-y-stack">
      <div className="flex items-center gap-tight text-xs uppercase tracking-wide theme-text-muted">
        {label}
        {info && <InfoTip label={label}>{info}</InfoTip>}
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
        info={
          <>
            Gas-weighted share of gas used by <Eq>type&nbsp;0/1</Eq> (legacy) vs{" "}
            <Eq>type&nbsp;≥2</Eq> (dynamic-fee). This is composition only —
            transaction <strong className="theme-text">type does not affect
            block ordering</strong>; ordering is by tip.
          </>
        }
      >
        <SplitBar legacyFraction={aggregate.legacyGasShare} />
      </StatCard>

      <StatCard
        label="Fees burned"
        value={pct(aggregate.burnedShare)}
        sub={`${nativeAmount(aggregate.burned, symbol)} destroyed`}
        info={
          <>
            <Eq>burned = baseFee × gasUsed</Eq>, destroyed rather than paid to
            anyone. <Eq>paid = burned + tips</Eq>; burn share ={" "}
            <Eq>burned ÷ paid</Eq>. Validators keep only the tips.
          </>
        }
      />

      <StatCard
        label="Priority inversions"
        value={pct(aggregate.priorityInversionRate)}
        sub="cross-sender pairs out of fee order"
        info={
          <>
            Blocks are ordered by <Eq>tip = effectiveGasPrice − baseFee</Eq> —
            the same axis for every type (legacy: <Eq>gasPrice</Eq>; type ≥2:{" "}
            <Eq>min(maxFee, baseFee + maxPriorityFee)</Eq>). A high-gas-price
            legacy tx has a high tip and is correctly first. An inversion = a
            later, different-sender tx out-tipped an earlier one.
          </>
        }
      />

      <StatCard
        label="Window"
        value={`${aggregate.blocksAnalyzed} blk`}
        sub={`${span(aggregate.fromTimestamp, aggregate.toTimestamp)} · head #${headBlock}`}
      />
    </div>
  );
}
