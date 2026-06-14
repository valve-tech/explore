import { type CSSProperties, type ReactNode } from "react";
import type { CallType, TraceFrame } from "../types.js";
import { formatGas } from "./formatters.js";
import {
  DEFAULT_CALL_TYPE_COLORS,
  getCallTypeStyle,
} from "./CallTree/theme.js";
import { countFrames } from "./CallTree/countFrames.js";
import { CallNode } from "./CallTree/CallNode.js";
import type { CallTreeClassNames } from "./CallTree/types.js";
import { ChevronRightIcon } from "../icons/ChevronRightIcon.js";
import { ArrowRightIcon } from "../icons/ArrowRightIcon.js";

export type { CallTreeClassNames };

export interface CallTreeProps {
  /** Root frame of the trace. Renders the entire tree underneath. */
  frame: TraceFrame;
  /** Optional click handler — invoked with the clicked frame. */
  onSelect?: (frame: TraceFrame) => void;
  /** How many levels are expanded initially. Default: 2. */
  defaultExpandedDepth?: number;
  /** Symbol shown alongside non-zero values. Default: "PLS". */
  valueSymbol?: string;
  /** Hide the header (title + counts). */
  hideHeader?: boolean;
  /** Hide the legend chips. */
  hideLegend?: boolean;
  /**
   * Caret rendered in each expandable row's toggle button; rotates 90° when
   * the row is expanded. Defaults to the built-in `ChevronRightIcon`.
   */
  expandIcon?: ReactNode;
  /**
   * Glyph rendered between a frame's from and to addresses. Defaults to the
   * built-in `ArrowRightIcon`.
   */
  arrowIcon?: ReactNode;
  /** Per-slot class names for theming. */
  classNames?: CallTreeClassNames;
  /** Inline style on the root element. */
  style?: CSSProperties;
  /** className on the root element (in addition to classNames.root). */
  className?: string;
}

/**
 * Headless call-tree renderer. Pass a normalized `TraceFrame` (from any SDK
 * loader); the component handles expand/collapse, click selection, and
 * inline detail panels.
 *
 * Theming: default colors are built in. Override via `classNames` for
 * slot-level targeting, or wrap the component and use CSS cascade.
 *
 * Self-contained: no external CSS framework required. Works inside a Tailwind
 * app, a vanilla app, or anywhere React runs.
 */
export function CallTree({
  frame,
  onSelect,
  defaultExpandedDepth = 2,
  valueSymbol = "PLS",
  hideHeader = false,
  hideLegend = false,
  expandIcon = <ChevronRightIcon size={12} />,
  arrowIcon = <ArrowRightIcon size={12} />,
  classNames = {},
  style,
  className,
}: CallTreeProps): React.JSX.Element {
  const totalCalls = countFrames(frame);

  return (
    <div
      className={[className, classNames.root].filter(Boolean).join(" ")}
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid rgba(139, 148, 158, 0.2)",
        backgroundColor: "rgba(139, 148, 158, 0.03)",
        ...style,
      }}
    >
      {!hideHeader && (
        <Header
          totalCalls={totalCalls}
          totalGas={frame.gasUsed}
          className={classNames.header}
        />
      )}

      {!hideLegend && <Legend className={classNames.legend} />}

      <div className={classNames.tree} style={{ overflowX: "auto" }}>
        <CallNode
          frame={frame}
          depth={0}
          defaultExpanded={defaultExpandedDepth > 0}
          defaultExpandedDepth={defaultExpandedDepth}
          onSelect={onSelect}
          valueSymbol={valueSymbol}
          classNames={classNames}
          expandIcon={expandIcon}
          arrowIcon={arrowIcon}
        />
      </div>
    </div>
  );
}

function Header({
  totalCalls,
  totalGas,
  className,
}: {
  totalCalls: number;
  totalGas: bigint;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          margin: 0,
          color: "#c9d1d9",
        }}
      >
        Execution Call Tree
      </h3>
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 11,
          color: "#8b949e",
        }}
      >
        <span>
          {totalCalls} call{totalCalls !== 1 ? "s" : ""}
        </span>
        <span>{formatGas(totalGas)} total gas</span>
      </div>
    </div>
  );
}

function Legend({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 16,
      }}
    >
      {(Object.keys(DEFAULT_CALL_TYPE_COLORS) as CallType[]).map((type) => {
        const s = getCallTypeStyle(type);
        return (
          <span
            key={type}
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: s.bg,
              color: s.text,
            }}
          >
            {type}
          </span>
        );
      })}
    </div>
  );
}
