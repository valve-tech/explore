/**
 * Two-segment bar: legacy (type 0/1, amber) vs modern (type ≥2, accent). The
 * shared visual vocabulary for every gas/cost/revenue split on the page.
 *
 * `modernBurnedFraction` (0–1), when given, scores the burned share of the
 * MODERN segment with a diagonal hatch — so you can see at a glance how much of
 * the modern slice was destroyed as base fee vs. kept as tips.
 */
export function SplitBar({
  legacyFraction,
  modernBurnedFraction,
  height = "h-2",
}: {
  legacyFraction: number;
  modernBurnedFraction?: number;
  height?: string;
}) {
  const legacyPct = Math.round(Math.min(1, Math.max(0, legacyFraction)) * 100);
  const burnPct =
    modernBurnedFraction == null
      ? 0
      : Math.round(Math.min(1, Math.max(0, modernBurnedFraction)) * 100);
  return (
    <div className={`flex ${height} w-full overflow-hidden bs-in-muted`}>
      <div
        style={{ width: `${legacyPct}%`, backgroundColor: "var(--color-warning)" }}
      />
      <div
        className="relative"
        style={{
          width: `${100 - legacyPct}%`,
          backgroundColor: "var(--color-accent)",
        }}
      >
        {burnPct > 0 && (
          <div
            className="hatch-burn absolute inset-y-0 left-0"
            style={{ width: `${burnPct}%` }}
          />
        )}
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
            className="hatch-burn inline-block h-2 w-2"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          burned
        </span>
      )}
    </div>
  );
}
