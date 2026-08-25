import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Gap the popover keeps between itself and either screen edge. */
const GUTTER = 8;
/** Widest the popover ever draws. Matches the old `w-72`. */
const MAX_WIDTH = 288;

/**
 * Place the popover under its trigger and keep it on screen.
 *
 * The popover used to be `position: absolute; left: 0; width: 18rem` inside the
 * ⓘ trigger. An absolutely-positioned box still grows its scroll container, so
 * a trigger sitting far to the right threw 288px of bubble past the right edge
 * and gave the whole page 205px of horizontal scroll at 375px. Fixed
 * positioning takes the bubble out of that measurement, and this clamp keeps
 * the text readable instead of parking it off screen.
 */
export function tipGeometry(
  anchorLeft: number,
  anchorBottom: number,
  viewportWidth: number,
): { left: number; top: number; width: number } {
  const width = Math.max(0, Math.min(MAX_WIDTH, viewportWidth - GUTTER * 2));
  const maxLeft = Math.max(GUTTER, viewportWidth - width - GUTTER);
  return {
    left: Math.min(Math.max(GUTTER, anchorLeft), maxLeft),
    top: anchorBottom + 4,
    width,
  };
}

/**
 * A small "ⓘ" affordance that reveals an explanation on hover or focus. Used to
 * attach the fee equations to each metric inline. The popover overrides the
 * uppercase/tracking context of card labels so equations read normally, and it
 * renders through a portal — the same trick the house `Tooltip` primitive uses
 * — so no card, table, or scroll area can clip it or be widened by it.
 */
export function InfoTip({
  children,
  label = "explanation",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setRect(r);
  };
  const close = () => setRect(null);

  const geometry = rect
    ? tipGeometry(rect.left, rect.bottom, window.innerWidth)
    : null;

  return (
    <span
      ref={ref}
      className="inline-flex align-middle"
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={geometry ? id : undefined}
        className="cursor-help select-none theme-text-muted hover:theme-text"
      >
        ⓘ
      </button>
      {geometry &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-50 card p-2 text-xs font-normal normal-case leading-relaxed tracking-normal"
            style={{
              left: geometry.left,
              top: geometry.top,
              width: geometry.width,
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** Inline monospace fragment for equations inside a tooltip. */
export function Eq({ children }: { children: ReactNode }) {
  return <code className="theme-mono theme-text">{children}</code>;
}
