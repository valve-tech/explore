/**
 * Two-segment bar: legacy (type 0/1, amber) vs modern (type ≥2, accent). The
 * shared visual vocabulary for every gas/cost/revenue split on the page.
 *
 * `legacyBurnedFraction` / `modernBurnedFraction` (0–1), when given, score the
 * burned share of each segment with a diagonal hatch — so you can see how much
 * of each slice was destroyed as base fee vs. kept as tips. BOTH types burn the
 * base fee (every tx pays ≥ baseFee), so both segments can carry a hatch; the
 * fractions differ because legacy and modern txs tip differently.
 */
function clampPct(v: number | undefined): number {
  return v == null ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 100);
}

export function SplitBar({
  legacyFraction,
  legacyBurnedFraction,
  modernBurnedFraction,
  height = "h-2",
  fillFraction,
}: {
  legacyFraction: number;
  legacyBurnedFraction?: number;
  modernBurnedFraction?: number;
  height?: string;
  /**
   * When set (0–1), the legacy/modern split fills only this fraction of the
   * track, so the bar's LENGTH encodes magnitude (e.g. gasUsed / gasLimit —
   * a fuller block draws a wider bar). Omit for a pure share bar (fills 100%).
   */
  fillFraction?: number;
}) {
  const legacyPct = Math.round(Math.min(1, Math.max(0, legacyFraction)) * 100);
  const legacyBurn = clampPct(legacyBurnedFraction);
  const modernBurn = clampPct(modernBurnedFraction);
  const fillPct = fillFraction == null ? 100 : clampPct(fillFraction);
  return (
    <div className={`${height} w-full overflow-hidden bs-in-muted`}>
      {/* The filled portion carries the type split; the rest of the track stays
          empty so the bar length reads as magnitude when fillFraction is set. */}
      <div className="flex h-full" style={{ width: `${fillPct}%` }}>
        <div
          className="relative"
          style={{ width: `${legacyPct}%`, backgroundColor: "var(--color-warning)" }}
        >
          {legacyBurn > 0 && (
            <div
              className="burn-mark absolute inset-y-0 left-0"
              style={{ width: `${legacyBurn}%` }}
            />
          )}
        </div>
        <div
          className="relative"
          style={{
            width: `${100 - legacyPct}%`,
            backgroundColor: "var(--color-accent)",
          }}
        >
          {modernBurn > 0 && (
            <div
              className="burn-mark absolute inset-y-0 left-0"
              style={{ width: `${modernBurn}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Legend chip mapping the colors + the burn hatch to their meaning. */
export function TypeLegend({ showBurn = false }: { showBurn?: boolean }) {
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
      {showBurn && (
        <span className="flex items-center gap-tight">
          <span
            className="burn-mark inline-block h-2 w-2"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          burned
        </span>
      )}
    </div>
  );
}
