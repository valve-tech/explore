import type { TypeSplit, WindowAggregate } from "../../api/networkHealth";
import { Tooltip } from "../primitives/Tooltip";
import { pct } from "./format";

/**
 * Where each tx type's gas falls in block ordering. Two rows (legacy, modern),
 * one cell per position bucket (top → bottom of block). Cell intensity ∝ that
 * type's gas in the bucket, normalized across both rows so the rows compare.
 */
export function PositionHeatmap({
  histogram,
  avgPosition,
  modernBurnedFraction,
}: {
  histogram: TypeSplit<number[]>;
  avgPosition: WindowAggregate["avgPositionByType"];
  /** Burned share of modern txs' fees, hatched across the modern row. */
  modernBurnedFraction?: number;
}) {
  const max = Math.max(
    0.0001,
    ...histogram.legacy,
    ...histogram.modern,
  );
  return (
    <div className="card p-4 space-y-stack">
      <div>
        <div className="text-sm theme-text">Position distribution</div>
        <div className="text-xs theme-text-muted">
          gas by block position — clustering near the top means earlier inclusion
        </div>
      </div>

      <Row
        label="legacy"
        buckets={histogram.legacy}
        max={max}
        color="var(--color-warning)"
        avg={avgPosition.legacy}
      />
      <Row
        label="modern"
        buckets={histogram.modern}
        max={max}
        color="var(--color-accent)"
        avg={avgPosition.modern}
        burnedFraction={modernBurnedFraction}
      />

      <div className="flex justify-between text-xs theme-text-muted">
        <span>top of block</span>
        <span>bottom</span>
      </div>
    </div>
  );
}

function Row({
  label,
  buckets,
  max,
  color,
  avg,
  burnedFraction,
}: {
  label: string;
  buckets: number[];
  max: number;
  color: string;
  avg: number | null;
  burnedFraction?: number;
}) {
  const burnPct =
    burnedFraction == null
      ? 0
      : Math.round(Math.min(1, Math.max(0, burnedFraction)) * 100);
  const burnNote = burnPct > 0 ? ` · ${burnPct}% of fees burned` : "";
  return (
    <div className="flex items-center gap-inline">
      <div className="w-16 shrink-0 text-xs theme-text-secondary">{label}</div>
      <div className="flex grow gap-tight">
        {buckets.map((v, i) => (
          <Tooltip
            key={i}
            className="grow"
            label={`bucket ${i + 1}/10 · ${pct(v)} of ${label} gas${burnNote}`}
          >
            <div
              className="relative h-6 w-full bs-in-muted"
              style={{
                backgroundColor: color,
                opacity: 0.12 + 0.88 * (v / max),
              }}
            >
              {burnPct > 0 && (
                <div
                  className="hatch-burn absolute inset-x-0 top-0"
                  style={{ height: `${burnPct}%` }}
                />
              )}
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="w-20 shrink-0 text-right text-xs theme-mono theme-text-secondary">
        avg {avg === null ? "—" : avg.toFixed(2)}
      </div>
    </div>
  );
}
