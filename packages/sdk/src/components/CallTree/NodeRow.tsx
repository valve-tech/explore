import type { ReactNode } from "react";
import type { TraceFrame } from "../../types.js";
import {
  formatGas,
  formatWei,
  getFunctionSelector,
  truncateAddress,
} from "../formatters.js";
import { getCallTypeStyle } from "./theme.js";
import type { CallTreeClassNames } from "./types.js";

interface Props {
  frame: TraceFrame;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
  onSelect?: (frame: TraceFrame) => void;
  valueSymbol: string;
  classNames: CallTreeClassNames;
  /** Caret rendered inside the expand button (rotates 90° when expanded). */
  expandIcon: ReactNode;
  /** Glyph rendered between the from and to addresses. */
  arrowIcon: ReactNode;
}

export function NodeRow({
  frame,
  hasChildren,
  expanded,
  onToggleExpand,
  showDetails,
  onToggleDetails,
  onSelect,
  valueSymbol,
  classNames,
  expandIcon,
  arrowIcon,
}: Props) {
  const typeStyle = getCallTypeStyle(frame.type);
  const valueDisplay = formatWei(frame.value, valueSymbol);
  const selector = frame.functionName ?? getFunctionSelector(frame.input);

  return (
    <div
      className={classNames.nodeRow}
      onClick={onSelect ? () => onSelect(frame) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        marginBottom: 4,
        backgroundColor: "rgba(139, 148, 158, 0.08)",
        cursor: onSelect ? "pointer" : "default",
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          style={{
            flexShrink: 0,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            backgroundColor: "rgba(139, 148, 158, 0.15)",
            color: "#8b949e",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              transition: "transform 0.15s",
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            {expandIcon}
          </span>
        </button>
      ) : (
        <span
          style={{
            flexShrink: 0,
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "rgba(139, 148, 158, 0.4)",
              display: "inline-block",
            }}
          />
        </span>
      )}

      <span
        className={classNames.typeBadge}
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 4,
          flexShrink: 0,
          backgroundColor: typeStyle.bg,
          color: typeStyle.text,
        }}
      >
        {frame.type}
      </span>

      <span
        className={classNames.address}
        style={{ fontSize: 11, fontFamily: "monospace", color: "#8b949e" }}
      >
        {truncateAddress(frame.from)}
      </span>
      <span
        style={{
          color: "#6e7681",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {arrowIcon}
      </span>
      <span
        className={classNames.address}
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          fontWeight: 500,
          color: frame.to ? "#58a6ff" : "#3fb950",
        }}
      >
        {frame.to === null
          ? "(contract creation)"
          : truncateAddress(frame.to)}
      </span>

      <span
        className={classNames.selector}
        style={{ fontSize: 11, fontFamily: "monospace", color: "#c9d1d9" }}
      >
        {selector}
      </span>

      {valueDisplay && (
        <span
          className={classNames.value}
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            padding: "2px 6px",
            borderRadius: 4,
            backgroundColor: "rgba(63, 185, 80, 0.15)",
            color: "#3fb950",
          }}
        >
          {valueDisplay}
        </span>
      )}

      <span
        style={{
          fontSize: 11,
          marginLeft: "auto",
          flexShrink: 0,
          color: "#6e7681",
        }}
      >
        {formatGas(frame.gasUsed)} gas
      </span>

      {(frame.error || frame.revertReason) && (
        <span
          className={classNames.errorBadge}
          style={{
            fontSize: 11,
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 500,
            flexShrink: 0,
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            color: "#ef4444",
          }}
          title={frame.revertReason || frame.error}
        >
          REVERT
        </span>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleDetails();
        }}
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          border: "none",
          borderRadius: 4,
          backgroundColor: "rgba(139, 148, 158, 0.15)",
          color: "#8b949e",
          cursor: "pointer",
          fontSize: 10,
        }}
        title="Show details"
        aria-pressed={showDetails}
      >
        ⋯
      </button>
    </div>
  );
}
