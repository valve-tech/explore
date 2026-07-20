import type { ReactElement } from "react";

export interface MiddleTruncateProps {
  value: string;
  tailChars?: number;
  className?: string;
  title?: string;
}

/**
 * Middle-truncate a hash/address for display WITHOUT losing searchability. The
 * full `value` stays in the DOM as real text (two adjacent inline spans), so
 * browser find (Ctrl+F) matches the full string and selecting copies it whole —
 * the visible ellipsis is a CSS `text-overflow` artifact, not text content.
 * The leading span clips responsively; the last `tailChars` stay pinned.
 */
export function MiddleTruncate({
  value,
  tailChars = 4,
  className,
  title,
}: MiddleTruncateProps): ReactElement {
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
