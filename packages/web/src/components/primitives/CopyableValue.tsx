import { useState, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { copyToClipboard } from "../../lib/clipboard";

export interface CopyableValueProps {
  /** The complete, untruncated value. This is what gets copied and shown on hover. */
  value: string;
  /** What to render. Defaults to `value` — pass the shortened form when truncating. */
  children?: ReactNode;
  /**
   * Skip the hover/click affordance when nothing was actually hidden. A tooltip
   * that repeats what is already on screen is noise, and a copy target that
   * looks interactive for no reason is worse.
   */
  interactive?: boolean;
  className?: string;
  /** Overrides the tooltip body. The full value is used when omitted. */
  label?: ReactNode;
}

/**
 * A truncated value that gives the full one back: hover (or focus) shows it,
 * click copies it.
 *
 * WHY THIS EXISTS: every abbreviated value in the app — an address, a hash, a
 * storage slot, an amount trimmed by `toResolutionGroups` — hides information
 * the reader sometimes needs. Truncation buys horizontal space, which is the
 * whole point on a dense table, but it is only acceptable if the full value is
 * one gesture away. Two gestures, really: hover to read, click to take.
 *
 * NOT `title=`. The native tooltip waits about a second, cannot be themed, and
 * is invisible to keyboard users — and `Tooltip`'s own docstring already says
 * this app should never mix browser-default and styled tooltips. `MiddleTruncate`
 * predates that rule and used `title`; it routes through here now.
 *
 * A BUTTON, not a span with onClick. Buttons are focusable and Enter/Space
 * activate them for free, so the same value is reachable by keyboard. The focus
 * ring is deliberately left alone — see the global `:focus-visible` rule.
 */
export function CopyableValue({
  value,
  children,
  interactive = true,
  className = "",
  label,
}: CopyableValueProps) {
  const [copied, setCopied] = useState(false);

  if (!interactive) {
    return <span className={className}>{children ?? value}</span>;
  }

  const onClick = (e: React.MouseEvent) => {
    // These sit inside table rows and entity cards that are themselves links.
    // Without this, copying a value also navigates away from the page you were
    // reading it on.
    e.stopPropagation();
    e.preventDefault();
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    });
  };

  return (
    <Tooltip label={copied ? "Copied!" : label ?? value} className={className}>
      <button
        type="button"
        onClick={onClick}
        aria-label={`${value} — click to copy`}
        // `text-left` because a button centres its text by default, which would
        // knock every truncated value out of its column. `min-w-0` lets the
        // child ellipsis actually clip inside a flex/grid cell instead of
        // forcing the cell wider than its track.
        className="min-w-0 cursor-pointer bg-transparent p-0 text-left font-[inherit] text-[inherit] leading-[inherit]"
        style={{ color: copied ? "var(--color-success)" : undefined }}
      >
        {children ?? value}
      </button>
    </Tooltip>
  );
}
