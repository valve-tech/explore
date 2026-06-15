/**
 * Two-segment bar: legacy (type 0/1, amber) vs modern (type ≥2, accent). The
 * shared visual vocabulary for every gas/cost/revenue split on the page.
 */
export function SplitBar({
  legacyFraction,
  height = "h-2",
}: {
  legacyFraction: number;
  height?: string;
}) {
  const legacyPct = Math.round(Math.min(1, Math.max(0, legacyFraction)) * 100);
  return (
    <div className={`flex ${height} w-full overflow-hidden bs-in-muted`}>
      <div
        style={{ width: `${legacyPct}%`, backgroundColor: "var(--color-warning)" }}
      />
      <div
        style={{
          width: `${100 - legacyPct}%`,
          backgroundColor: "var(--color-accent)",
        }}
      />
    </div>
  );
}

/** Legend chip mapping the two colors to the type buckets. */
export function TypeLegend() {
  return (
    <div className="flex gap-row text-xs theme-text-muted">
      <span className="flex items-center gap-tight">
        <span
          className="inline-block h-2 w-2"
          style={{ backgroundColor: "var(--color-warning)" }}
        />
        legacy (0/1)
      </span>
      <span className="flex items-center gap-tight">
        <span
          className="inline-block h-2 w-2"
          style={{ backgroundColor: "var(--color-accent)" }}
        />
        modern (≥2)
      </span>
    </div>
  );
}
