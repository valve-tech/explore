import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom";

/**
 * Themed hover/focus tooltip — the one label-on-hover primitive for every
 * feature, replacing native `title=` so the UI never mixes browser-default and
 * styled tooltips.
 *
 * Visibility is React state (not CSS `:hover`) so it also responds to keyboard
 * focus — the trigger should be focusable (button/link). The bubble is rendered
 * through a portal with `position: fixed`, anchored to the trigger's rect, so it
 * never clips inside `overflow` containers (tables, scroll areas, cards). The
 * wrapper is `inline-flex`; pass `className` (e.g. "grow") to fit flex layouts.
 *
 * Pass `wrap` for a label longer than a few words. The bubble then wraps
 * inside a capped width. Every bubble moves sideways to stay in the viewport.
 */

/** Keep this many pixels between the bubble and the viewport edge. */
const EDGE = 4;

/** Shift a mounted bubble sideways until the viewport shows all of it. */
function keepInViewport(el: HTMLSpanElement | null) {
  if (!el) return;
  // React can call this twice. Clear the last shift before measuring.
  el.style.marginLeft = "";
  const box = el.getBoundingClientRect();
  const over = box.right - (window.innerWidth - EDGE);
  const shift = box.left < EDGE ? EDGE - box.left : over > 0 ? -over : 0;
  if (shift !== 0) el.style.marginLeft = `${shift}px`;
}

/** See the note above. */
export function Tooltip({
  label,
  side = "top",
  children,
  className = "",
  wrap = false,
}: {
  label: ReactNode;
  side?: Side;
  children: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setRect(r);
  };
  const close = () => setRect(null);
  // An empty label turns the tooltip off. A host uses this while its own
  // popover is open.
  const hasLabel = label != null && label !== false && label !== "";

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      aria-describedby={rect && hasLabel ? id : undefined}
    >
      {children}
      {rect &&
        hasLabel &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            ref={keepInViewport}
            className={`fixed z-50 text-[11px] px-2.5 py-1.5 pointer-events-none ${
              wrap
                ? "w-max max-w-[min(20rem,calc(100vw-0.5rem))] whitespace-normal [overflow-wrap:anywhere]"
                : "whitespace-nowrap"
            }`}
            style={{
              left: rect.left + rect.width / 2,
              top: side === "top" ? rect.top - 7 : rect.bottom + 7,
              transform:
                side === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
              boxShadow:
                "0 0 0 1px var(--color-border-default), 0 6px 18px rgba(0,0,0,0.5)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
