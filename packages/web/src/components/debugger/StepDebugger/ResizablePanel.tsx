import { useCallback, useRef } from "react";
import { Tooltip } from "../../primitives/Tooltip";

/**
 * A fixed-width panel with a draggable handle on its right edge. Used to make
 * the call tree wide enough to read full frame labels without horizontal
 * scrolling. Width is owned by the parent so it can be persisted.
 */
export function ResizablePanel({
  width,
  onResize,
  min = 240,
  max = 760,
  height,
  children,
}: {
  width: number;
  onResize: (width: number) => void;
  min?: number;
  max?: number;
  height?: string;
  children: React.ReactNode;
}) {
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = width;
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(max, Math.max(min, startW.current + (ev.clientX - startX.current)));
        onResize(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, min, max, onResize],
  );

  return (
    <div className="flex flex-shrink-0" style={{ width, height }}>
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      {/* Drag handle — a hairline that widens its hit area on hover. */}
      <Tooltip label="Drag to resize" className="w-1 flex-shrink-0">
        <div
          onPointerDown={onPointerDown}
          className="w-1 flex-shrink-0 cursor-col-resize bs-r-in"
        />
      </Tooltip>
    </div>
  );
}
