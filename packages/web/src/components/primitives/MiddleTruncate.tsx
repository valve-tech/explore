import type { ReactElement } from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";

export interface MiddleTruncateProps {
  value: string;
  tailChars?: number;
  className?: string;
  title?: string;
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
 */
export function MiddleTruncate({
  value,
  tailChars = 4,
  className,
  title,
}: MiddleTruncateProps): ReactElement {
  const isMobile = useIsMobile();

  // Phone: the full value wraps in place. Same DOM text as desktop (searchable),
  // just no single-line clip — so it flows instead of overflowing.
  if (isMobile) {
    return (
      <span
        className={`break-all${className ? ` ${className}` : ""}`}
        title={title ?? value}
      >
        {value}
      </span>
    );
  }

  const outer = `mt${className ? ` ${className}` : ""}`;
  if (value.length <= tailChars) {
    return (
      <span className={outer} title={title ?? value}>
        <span className="mt-tail">{value}</span>
      </span>
    );
  }
  return (
    <span className={outer} title={title ?? value}>
      <span className="mt-lead">{value.slice(0, -tailChars)}</span>
      <span className="mt-tail">{value.slice(-tailChars)}</span>
    </span>
  );
}
