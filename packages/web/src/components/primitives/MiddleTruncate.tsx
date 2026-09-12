import type { ReactElement } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { CopyableValue } from "./CopyableValue";

export interface MiddleTruncateProps {
  value: string;
  tailChars?: number;
  className?: string;
  /**
   * When true (default, desktop only), hover shows the full value in a themed
   * tooltip and click copies it — replacing the native `title=` tooltip, which
   * waits ~1s, cannot be themed, and is invisible to keyboard users.
   *
   * Set false when this sits inside an `<a>` or `<button>` that handles its own
   * navigation: `CopyableValue`'s button does `stopPropagation` + `preventDefault`
   * (load-bearing — without it, clicking inside a row that is itself a link
   * navigates away instead of copying), so a link-wrapped copyable can never
   * navigate by clicking the value. The enclosing link's `title` still shows
   * the full value on hover when `copyable` is false.
   */
  copyable?: boolean;
}

/**
 * Display a hash/address WITHOUT losing searchability — the full `value` always
 * stays in the DOM as real text, so browser find (Ctrl+F) matches it and copy
 * yields the whole string.
 *
 * Two presentations by viewport:
 *   - Below `sm:` (phone): let the full value WRAP (`break-all`) onto a second
 *     line rather than middle-clipping. Text that reflows can never force
 *     horizontal scroll, and the whole value reads without a hover — the right
 *     trade on a narrow screen where a stacked cell owns its own line.
 *   - `sm:`+ (desktop): middle-truncate — two adjacent inline spans, the
 *     leading one clips with a CSS ellipsis, the last `tailChars` stay pinned —
 *     so dense tables stay compact.
 *
 * When `copyable` is true (default, desktop), the clipped value is wrapped in
 * `CopyableValue`: hover shows the full value in a themed `Tooltip`, and click
 * copies it. The full value stays in the DOM text either way.
 */
export function MiddleTruncate({
  value,
  tailChars = 4,
  className,
  copyable = true,
}: MiddleTruncateProps): ReactElement {
  const isMobile = useIsMobile();

  // Phone: the full value wraps in place. Same DOM text as desktop (searchable),
  // just no single-line clip — so it flows instead of overflowing. The full
  // value is already visible, so no tooltip/copy affordance is needed.
  if (isMobile) {
    return (
      <span
        className={`break-all${className ? ` ${className}` : ""}`}
        title={value}
      >
        {value}
      </span>
    );
  }

  const outer = `mt${className ? ` ${className}` : ""}`;
  if (value.length <= tailChars) {
    if (copyable) {
      // Short value: nothing is hidden, so skip the interactive affordance —
      // a tooltip that repeats what is on screen is noise (CopyableValue's
      // `interactive` contract).
      return (
        <CopyableValue value={value} interactive={false} className={outer}>
          <span className="mt-tail">{value}</span>
        </CopyableValue>
      );
    }
    return (
      <span className={outer} title={value}>
        <span className="mt-tail">{value}</span>
      </span>
    );
  }
  const lead = value.slice(0, -tailChars);
  const tail = value.slice(-tailChars);
  if (copyable) {
    return (
      <CopyableValue value={value} className={outer}>
        <span className="mt-lead">{lead}</span>
        <span className="mt-tail">{tail}</span>
      </CopyableValue>
    );
  }
  return (
    <span className={outer} title={value}>
      <span className="mt-lead">{lead}</span>
      <span className="mt-tail">{tail}</span>
    </span>
  );
}
