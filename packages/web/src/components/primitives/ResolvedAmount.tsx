import { toResolutionGroups } from "../../lib/format/resolution";
import { CopyableValue } from "./CopyableValue";

/**
 * A token amount rendered with three-group resolution and a hover-to-copy
 * affordance, for dense table rows where the full fraction costs width nobody
 * reads.
 *
 * `formatted` is the full display string from `formatPLS` or `formatAmountDisplay`
 * — already grouped and capped. `toResolutionGroups` trims it to at most three
 * significant three-digit groups; `CopyableValue` shows the full `formatted` on
 * hover and copies it on click. The full value stays in the DOM text either way.
 *
 * NOT for detail views (AddressHeader, OverviewSection) — those read in full,
 * and trimming a value someone is studying is the wrong trade. Use the plain
 * `formatPLS`/`formatAmountDisplay` result there.
 */
export function ResolvedAmount({
  formatted,
  className = "",
}: {
  formatted: string;
  className?: string;
}) {
  const { display, truncated } = toResolutionGroups(formatted);
  if (!truncated) {
    // Nothing was hidden — a tooltip that repeats the visible text is noise.
    return <span className={className}>{display}</span>;
  }
  return (
    <CopyableValue value={formatted} className={className}>
      {display}
    </CopyableValue>
  );
}
