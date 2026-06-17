import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { getOpcodeColor } from "@valve-tech/trace-sdk";
import { Tooltip } from "../../primitives/Tooltip";
import type { OpcodeStep } from "../../../api/debugger";

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

/**
 * Modal overlay listing the opcodes a single call frame executed — the steps
 * from its entry until execution returns above its depth. Deeper rows (nested
 * calls) are indented so you can see where sub-calls happen "in between" the
 * frame's own opcodes. Clicking a row jumps the debugger there and closes.
 */
export function FrameOpcodesOverlay({
  steps,
  from,
  to,
  label,
  frameType,
  currentStep,
  onJumpTo,
  onClose,
}: {
  steps: OpcodeStep[];
  from: number;
  to: number;
  label: string;
  frameType: string;
  currentStep: number;
  onJumpTo: (step: number) => void;
  onClose: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);

  const count = Math.max(0, to - from);
  const baseDepth = steps[from]?.depth ?? 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Measure the viewport AND keep the cursor's row visible. useLayoutEffect
  // runs before paint, so the initial mount never flashes scrolled-to-top.
  // Re-runs on currentStep so that arrow-stepping (which the parent now
  // clamps to this frame's range) keeps the active row on screen. Same
  // out-of-view-then-center pattern as OpcodeTracePane: if the row is
  // already visible, don't yank the scroll position.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const h = el.clientHeight;
    setViewportH(h);
    if (currentStep < from || currentStep >= to) return;
    const rowTop = (currentStep - from) * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + h;
    if (rowTop < viewTop || rowBottom > viewBottom) {
      el.scrollTop = Math.max(0, rowTop - h / 2 + ROW_HEIGHT / 2);
    }
  }, [currentStep, from, to]);

  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleEnd = Math.min(count, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);

  const rows = useMemo(() => {
    const out: number[] = [];
    for (let i = visibleStart; i < visibleEnd; i++) out.push(from + i);
    return out;
  }, [visibleStart, visibleEnd, from]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="card flex flex-col overflow-hidden"
        style={{
          width: "min(720px, 92vw)",
          height: "min(80vh, 720px)",
          boxShadow: "0 0 0 1px var(--color-border-default), 0 12px 40px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-row px-3 py-2 card-divider theme-secondary-bg">
          <span
            className="text-[9px] font-semibold tracking-wide px-1 py-0.5 theme-danger"
            style={{ boxShadow: "inset 0 0 0 1px var(--color-danger)" }}
          >
            {frameType}
          </span>
          <span className="text-xs font-semibold truncate theme-mono theme-text">
            {label}
          </span>
          <span className="text-xs theme-text-muted theme-mono">
            {count.toLocaleString()} ops · steps {from.toLocaleString()}–{(to - 1).toLocaleString()}
          </span>
          {/* When the cursor walks outside the frame (e.g. via Cmd+[ nav
              history), the active-row highlight disappears. Surface that
              explicitly so the user understands why the list doesn't reflect
              their current position. */}
          {(currentStep < from || currentStep >= to) && (
            <Tooltip label={`Cursor is at step ${currentStep.toLocaleString()}, outside this frame's range.`}>
              <span
                className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 theme-warning theme-mono"
                style={{ boxShadow: "inset 0 0 0 1px var(--color-warning)" }}
              >
                cursor outside · step {currentStep.toLocaleString()}
              </span>
            </Tooltip>
          )}
          <Tooltip label="Close (Esc)" className="ml-auto flex-shrink-0">
            <button onClick={onClose} className="flex-shrink-0 theme-text-muted">
              <Icon icon="heroicons:x-mark" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <div
          ref={scrollerRef}
          className="overflow-y-auto flex-1"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div style={{ height: count * ROW_HEIGHT, position: "relative" }}>
            {rows.map((idx) => {
              const s = steps[idx]!;
              const isActive = idx === currentStep;
              return (
                <div
                  key={idx}
                  onClick={() => { onJumpTo(idx); onClose(); }}
                  className={`flex items-center cursor-pointer text-xs theme-mono${isActive ? " theme-accent-bg bs-l-accent-in" : ""}`}
                  style={{
                    position: "absolute",
                    top: (idx - from) * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    width: "100%",
                    paddingLeft: `${8 + (s.depth - baseDepth) * 12}px`,
                    paddingRight: "12px",
                  }}
                >
                  <span className="w-16 text-right mr-3 flex-shrink-0 theme-text-muted">{idx}</span>
                  <span className="w-10 text-right mr-3 flex-shrink-0 theme-text-muted">{s.pc}</span>
                  <span className="font-semibold mr-3 flex-shrink-0" style={{ color: getOpcodeColor(s.op) }}>{s.op}</span>
                  {s.depth > baseDepth && (
                    <span className="flex-shrink-0 text-[9px] theme-text-muted">
                      ↳ depth {s.depth}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
