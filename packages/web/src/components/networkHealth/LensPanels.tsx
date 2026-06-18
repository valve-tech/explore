import type { WindowAggregate } from "../../api/networkHealth";
import { SplitBar, TypeLegend } from "./SplitBar";
import { InfoTip, Eq } from "./InfoTip";
import { nativeAmount, pct, shareOf, span } from "./format";

/**
 * The two lenses, paired. Same per-gas amount split at the base-fee line:
 *   paid (user cost) = burned (destroyed) + tips (validator revenue).
 * The contrast is the point — burn is the wedge between what users spend and
 * what validators actually earn.
 */
export function LensPanels({
  aggregate,
  symbol,
  burnsBaseFee,
}: {
  aggregate: WindowAggregate;
  symbol: string;
  burnsBaseFee: boolean;
}) {
  const tipsShareOfPaid = shareOf(aggregate.tips, aggregate.paid);
  const period = `over ${aggregate.blocksAnalyzed.toLocaleString()} blocks · ~${span(aggregate.fromTimestamp, aggregate.toTimestamp)}`;

  return (
    <div className="space-y-stack">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-tight text-sm uppercase tracking-wide theme-text-secondary">
          User cost vs validator revenue
          <InfoTip label="user cost vs validator revenue">
            Each tx's price splits:{" "}
            <Eq>effectiveGasPrice = baseFee + tip</Eq>. Users pay the whole price
            (cost); the base fee is burned; validators earn only the tip
            (revenue). So <Eq>paid = burned + tips</Eq>.
          </InfoTip>
        </h2>
        <TypeLegend showBurn />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-row">
        <Lens
          title="User cost"
          help="what senders paid, per gas × gas used"
          total={nativeAmount(aggregate.paid, symbol)}
          period={period}
          legacyFraction={shareOf(aggregate.paidByType.legacy, aggregate.paid)}
          modernBurnedFraction={
            burnsBaseFee
              ? shareOf(aggregate.burnedByType.modern, aggregate.paidByType.modern)
              : 0
          }
          footer={
            burnsBaseFee
              ? `${pct(aggregate.burnedShare)} burned · ${pct(tipsShareOfPaid)} to validators`
              : "base fee retained by validator on this chain"
          }
          accent="var(--color-text-primary)"
        />
        <Lens
          title="Validator revenue"
          help={burnsBaseFee ? "tips kept — base fee is burned" : "full fees kept"}
          total={nativeAmount(aggregate.tips, symbol)}
          period={period}
          legacyFraction={shareOf(aggregate.tipsByType.legacy, aggregate.tips)}
          footer={`${pct(tipsShareOfPaid)} of what users spent`}
          accent="var(--color-success)"
        />
      </div>
    </div>
  );
}

function Lens({
  title,
  help,
  total,
  period,
  legacyFraction,
  modernBurnedFraction,
  footer,
  accent,
}: {
  title: string;
  help: string;
  total: string;
  period: string;
  legacyFraction: number;
  modernBurnedFraction?: number;
  footer: string;
  accent: string;
}) {
  return (
    <div className="card p-4 space-y-stack">
      <div>
        <div className="text-sm theme-text">{title}</div>
        <div className="text-xs theme-text-muted">{help}</div>
      </div>
      <div>
        <div className="text-2xl theme-mono" style={{ color: accent }}>
          {total}
        </div>
        <div className="text-xs theme-text-muted">{period}</div>
      </div>
      <SplitBar
        legacyFraction={legacyFraction}
        modernBurnedFraction={modernBurnedFraction}
        height="h-2.5"
      />
      <div className="text-xs theme-text-secondary">{footer}</div>
    </div>
  );
}
