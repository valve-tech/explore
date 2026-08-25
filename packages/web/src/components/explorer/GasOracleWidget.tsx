import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@iconify/react";
import { fetchGasOracle, type TierName, type Trend } from "../../api/gas";
import { useActiveChainId } from "../../lib/activeChain";
import { formatGweiDisplay } from "./format";
import { Tooltip } from "../primitives/Tooltip";

const TIERS: { key: TierName; label: string }[] = [
  { key: "slow", label: "Slow" },
  { key: "standard", label: "Standard" },
  { key: "fast", label: "Fast" },
  { key: "instant", label: "Instant" },
];

const TREND: Record<Trend, { icon: string; color: string }> = {
  rising: { icon: "heroicons:arrow-trending-up", color: "var(--color-warning)" },
  falling: { icon: "heroicons:arrow-trending-down", color: "var(--color-success)" },
  stable: { icon: "heroicons:minus", color: "var(--color-text-muted)" },
};

/** Sticky tier selection — persists the bar the user last landed on. */
const STORAGE_KEY = "explorer.gasTier";

function isTierName(v: string | null): v is TierName {
  return v != null && TIERS.some((t) => t.key === v);
}

/** Read the persisted tier, falling back to "standard". localStorage access
 *  is wrapped because it throws in private-mode / sandboxed contexts. */
function readStoredTier(): TierName {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isTierName(v)) return v;
  } catch {
    /* localStorage unavailable — use default */
  }
  return "standard";
}

function persistTier(tier: TierName): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    /* non-fatal: selection still works for this session */
  }
}

/**
 * wei decimal string → gwei display string. Delegates to `format.ts`'s
 * `formatGweiDisplay`, the SAME formatter the explorer stat cards use
 * (subscript notation below 1 gwei, grouped + 2dp otherwise), so a base fee
 * never reads as "0 gwei" here while the stat card above shows the real
 * sub-gwei value.
 */
function gwei(wei: string): string {
  return formatGweiDisplay(wei);
}

/**
 * wei decimal string → numeric gwei, ONLY for proportional bar sizing (pixel
 * widths). A float is appropriate here — the output drives a 5–18px bar, not a
 * displayed amount, so gwei-scale precision is irrelevant.
 */
function gweiNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e9;
  } catch {
    return 0;
  }
}

const BAR_MIN_PX = 5;
const BAR_MAX_PX = 18;

/** Scale a tier's priority tip to a bar height, relative to the tallest tier. */
function barHeight(tip: number, maxTip: number): number {
  if (maxTip <= 0) return BAR_MIN_PX;
  return BAR_MIN_PX + (tip / maxTip) * (BAR_MAX_PX - BAR_MIN_PX);
}

const SPARK_W = 52;
const SPARK_H = 14;

/** wei decimal string → finite number, ONLY for sparkline y-positioning
 *  (pixel geometry, not a displayed amount — same rationale as `gweiNum`). */
function weiNum(wei: string): number {
  try {
    return Number(BigInt(wei));
  } catch {
    return 0;
  }
}

/**
 * Compact inline base-fee sparkline over the oracle's `baseFeeHistory` — the
 * 21-block window the query already fetches, so this is zero extra network
 * cost. Plain SVG polyline, no charting library, sized to sit inline in the
 * one-line strip. Static (no animation), so there's nothing to gate behind
 * `prefers-reduced-motion`.
 */
function BaseFeeSparkline({
  history,
  trend,
}: {
  history: string[];
  trend: Trend;
}) {
  if (history.length < 2) return null;
  const values = history.map(weiNum);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = SPARK_W / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = SPARK_H - ((v - min) / range) * SPARK_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0"
      role="img"
      aria-label="Base fee, last 21 blocks"
    >
      <polyline
        points={points}
        fill="none"
        stroke={TREND[trend].color}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GasOracleWidget() {
  const chainId = useActiveChainId();
  const { data, status } = useQuery({
    queryKey: ["gas-oracle", chainId],
    queryFn: () => fetchGasOracle(chainId),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  // Seeded lazily from localStorage so there's no flash of the default tier.
  const [tier, setTier] = useState<TierName>(readStoredTier);

  function selectTier(next: TierName): void {
    setTier(next);
    persistTier(next);
  }

  return (
    <div className="card flex flex-wrap items-center gap-row p-2 text-xs">
      <div className="flex items-center gap-tight shrink-0">
        <Icon
          icon="heroicons:fire"
          className="w-4 h-4 theme-accent"
        />
        <span
          className="text-sm font-semibold theme-text"
        >
          Gas
        </span>
      </div>

      {status === "pending" && (
        <span className="theme-text-muted">
          Loading gas tiers…
        </span>
      )}

      {status === "error" && (
        <span className="theme-danger">
          Gas oracle unavailable
        </span>
      )}

      {status === "success" && (
        <>
          <span
            className="flex items-center gap-tight font-mono shrink-0 theme-text-secondary"
          >
            <span className="theme-text-muted">base</span>
            <span
              className="tabular-nums theme-text"
            >
              {gwei(data.baseFee)}
            </span>
            <span className="theme-text-muted">gwei</span>
            <Icon
              icon={TREND[data.baseFeeTrend].icon}
              className="w-3 h-3 shrink-0"
              style={{ color: TREND[data.baseFeeTrend].color }}
            />
            <BaseFeeSparkline history={data.baseFeeHistory} trend={data.baseFeeTrend} />
          </span>

          <TierGauge tier={tier} onSelect={selectTier} data={data} />

          <span
            className="flex items-baseline gap-tight font-mono shrink-0 theme-text-muted ml-auto"
          >
            <span
              className="tabular-nums theme-text-secondary"
            >
              {Number(data.mempool.pendingCount).toLocaleString()}
            </span>
            <span>pending</span>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The gauge *is* the selector: four bars scaled to each tier's priority tip.
 * Hovering or focusing a bar selects that tier (persisted immediately), and
 * the readout to its right reflects the active tier's tip / cap.
 *
 * Bars are <button>s so keyboard users get the same select-on-focus behavior
 * as mouse users get on hover — the gauge isn't mouse-only.
 *
 * Wraps internally (`flex-wrap`) so a chain with very large gwei figures
 * (e.g. chain 369) can drop its readout to a second line under the bars
 * instead of forcing the whole strip to overflow sideways.
 */
function TierGauge({
  tier,
  onSelect,
  data,
}: {
  tier: TierName;
  onSelect: (t: TierName) => void;
  data: Awaited<ReturnType<typeof fetchGasOracle>>;
}) {
  const maxTip = Math.max(
    ...TIERS.map((t) => gweiNum(data.tiers[t.key].maxPriorityFeePerGas)),
  );
  const active = data.tiers[tier];

  return (
    <span className="flex flex-wrap items-center gap-inline shrink-0">
      <span className="flex items-end gap-tight h-[18px] shrink-0">
        {TIERS.map((t) => {
          const isActive = t.key === tier;
          const tip = gweiNum(data.tiers[t.key].maxPriorityFeePerGas);
          return (
            <Tooltip
              key={t.key}
              label={`${t.label} · tip ${gwei(
                data.tiers[t.key].maxPriorityFeePerGas,
              )} / cap ${gwei(data.tiers[t.key].maxFeePerGas)} gwei`}
            >
              <button
                type="button"
                aria-label={`${t.label} priority fee`}
                aria-pressed={isActive}
                onMouseEnter={() => onSelect(t.key)}
                onFocus={() => onSelect(t.key)}
                className="appearance-none border-0 p-0 cursor-pointer w-[7px] transition-opacity"
                style={{
                  height: `${barHeight(tip, maxTip)}px`,
                  backgroundColor: isActive
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                  opacity: isActive ? 1 : 0.4,
                }}
              />
            </Tooltip>
          );
        })}
      </span>

      <span className="flex flex-wrap items-baseline gap-tight">
        <span
          className="text-[9px] uppercase tracking-wider font-semibold min-w-[52px] theme-accent"
        >
          {TIERS.find((t) => t.key === tier)?.label}
        </span>
        <span
          className="font-mono text-sm font-semibold tabular-nums text-right theme-text"
        >
          {gwei(active.maxPriorityFeePerGas)}
        </span>
        <span
          className="font-mono text-[10px] theme-text-muted"
        >
          / {gwei(active.maxFeePerGas)}
        </span>
        <span className="text-[11px] theme-text-muted">
          gwei
        </span>
      </span>
    </span>
  );
}
