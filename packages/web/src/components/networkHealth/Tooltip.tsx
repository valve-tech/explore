import { useState } from "react";

/**
 * Reusable hover tooltip — replaces the native `title=` attribute with a styled,
 * themeable component. The wrapper is `display: contents` so it never disturbs
 * the trigger's layout (flex grow, table cells, etc.), and the bubble is
 * `position: fixed` at the cursor so it escapes `overflow` clipping (table
 * scroll containers, cards). Pure CSS hover via React state — no portal needed.
 */
export function Tooltip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      style={{ display: "contents" }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          className="fixed z-50 card p-2 text-xs theme-text-secondary pointer-events-none whitespace-nowrap"
          style={{ left: pos.x + 12, top: pos.y + 14 }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
