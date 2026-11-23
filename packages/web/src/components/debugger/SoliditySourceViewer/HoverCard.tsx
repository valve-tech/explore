import { createPortal } from "react-dom";
import type { HoverValue } from "../StepDebugger/hoverValues/types";

const SOURCE_LABEL: Record<HoverValue["source"], string> = {
  stack: "stack",
  storage: "storage",
  calldata: "calldata",
  memory: "memory",
};

/**
 * The card under a hovered source token. It shows the value the identifier
 * holds at the current step (when the debugger knows it), then what a click
 * does. A portal with fixed position keeps it from clipping in the pane.
 */
export function HoverCard({
  rect,
  value,
  hint,
}: {
  rect: DOMRect;
  value: HoverValue | null;
  hint: string | null;
}) {
  if (!value && !hint) return null;
  return createPortal(
    <div
      role="tooltip"
      data-testid="source-hover-card"
      className="fixed z-50 p-2 text-[11px] theme-mono pointer-events-none"
      style={{
        left: rect.left,
        top: rect.bottom + 4,
        maxWidth: "min(480px, calc(100vw - 16px))",
        backgroundColor: "var(--color-bg-tertiary)",
        color: "var(--color-text-primary)",
        boxShadow: "0 0 0 1px var(--color-border-default), 0 6px 18px rgba(0,0,0,0.5)",
      }}
    >
      {value && (
        <div className="space-y-stack">
          <div className="flex items-center gap-inline">
            <span className="font-semibold">{value.name}</span>
            <span className="theme-text-muted">{value.type}</span>
            <span className="ml-auto theme-text-muted">{SOURCE_LABEL[value.source]}</span>
          </div>
          <div data-testid="source-hover-value" className="break-all theme-accent">
            {value.value}
          </div>
          {value.note && <div className="theme-text-muted">{value.note}</div>}
        </div>
      )}
      {hint && (
        <div className={value ? "pt-1 theme-text-muted" : "theme-text-secondary"}>{hint}</div>
      )}
    </div>,
    document.body,
  );
}
