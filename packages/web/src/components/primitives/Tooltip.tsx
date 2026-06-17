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
 */
export function Tooltip({
  label,
  side = "top",
  children,
  className = "",
}: {
  label: ReactNode;
  side?: Side;
  children: ReactNode;
  className?: string;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setRect(r);
  };
  const close = () => setRect(null);

  return (
    <span
      ref={ref}
      className={`inline-flex ${className}`}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      aria-describedby={rect ? id : undefined}
    >
      {children}
      {rect &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="fixed z-50 whitespace-nowrap text-[11px] px-2.5 py-1.5 pointer-events-none"
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
