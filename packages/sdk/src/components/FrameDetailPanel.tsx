import { type CSSProperties, type ReactNode } from "react";
import type { Hex } from "viem";
import type { CallType, DecodedParam, TraceFrame } from "../types.js";
import {
  formatGas,
  formatWei,
  getFunctionSelector,
  truncateAddress,
} from "./formatters.js";
import { ArrowRightIcon } from "../icons/ArrowRightIcon.js";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const CALL_TYPE_COLORS: Record<CallType, string> = {
  CALL: "#8B5CF6",
  STATICCALL: "#38bdf8",
  DELEGATECALL: "#fbbf24",
  CALLCODE: "#fb923c",
  CREATE: "#3fb950",
  CREATE2: "#3fb950",
  SELFDESTRUCT: "#ef4444",
};

const NEUTRAL_TEXT = "#c9d1d9";
const MUTED_TEXT = "#8b949e";
const SUBTLE_TEXT = "#6e7681";
const ERROR_BG = "rgba(239, 68, 68, 0.12)";
const ERROR_TEXT = "#f85149";

export interface FrameDetailPanelClassNames {
  /** Outer wrapper card. */
  root?: string;
  /** Header row (type badge + from→to). */
  header?: string;
  /** The call-type badge. */
  typeBadge?: string;
  /** The from address. */
  fromAddress?: string;
  /** The to address. */
  toAddress?: string;
  /** The error / revert banner. */
  errorBanner?: string;
  /** Container for the metadata grid (gas / value / selector / depth). */
  metaGrid?: string;
  /** One metadata cell. */
  metaCell?: string;
  /** A metadata label. */
  metaLabel?: string;
  /** A metadata value. */
  metaValue?: string;
  /** Section heading (e.g. "Input", "Output"). */
  sectionTitle?: string;
  /** A raw hex value rendered in a code block. */
  rawHex?: string;
  /** Container for a decoded params list. */
  decodedList?: string;
  /** One decoded param row. */
  decodedRow?: string;
}

export interface FrameDetailPanelProps {
  /** The frame whose details should be rendered. */
  frame: TraceFrame;
  /** Symbol shown next to value. Default: "PLS". */
  valueSymbol?: string;
  /** Hide the call-type badge + addresses header. */
  hideHeader?: boolean;
  /**
   * Glyph rendered between the from and to addresses in the header. Defaults
   * to the built-in `ArrowRightIcon`.
   */
  arrowIcon?: ReactNode;
  /** Per-slot class names for theming. */
  classNames?: FrameDetailPanelClassNames;
  /** Inline style on the root element. */
  style?: CSSProperties;
  /** className on the root element (in addition to classNames.root). */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHex(hex: Hex, max = 80): string {
  if (hex.length <= max) return hex;
  return `${hex.slice(0, max - 8)}…${hex.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: CSSProperties = {
  padding: "12px 16px",
  background: "rgba(13, 17, 23, 0.4)",
  borderRadius: "8px",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "13px",
};

const typeBadgeStyle = (callType: CallType): CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "4px",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  background: "rgba(0,0,0,0.2)",
  color: CALL_TYPE_COLORS[callType],
});

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
};

const metaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "6px 12px",
  marginTop: "6px",
};

const sectionTitleStyle: CSSProperties = {
  color: MUTED_TEXT,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginTop: "10px",
  marginBottom: "4px",
};

const rawHexStyle: CSSProperties = {
  display: "block",
  color: NEUTRAL_TEXT,
  fontSize: "12px",
  wordBreak: "break-all",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders metadata for a single `TraceFrame` — call type, participants, gas,
 * value, error state, and decoded I/O when available. Designed to drop in
 * next to a `CallTree` as the "what's selected" detail view.
 */
export function FrameDetailPanel({
  frame,
  valueSymbol = "PLS",
  hideHeader,
  arrowIcon = <ArrowRightIcon size={12} />,
  classNames,
  style,
  className,
}: FrameDetailPanelProps): React.JSX.Element {
  // `getFunctionSelector` returns a "(fallback)" sentinel for too-short
  // inputs; treat that as no selector for display purposes.
  const rawSelector = getFunctionSelector(frame.input);
  const selector = rawSelector === "(fallback)" ? null : (rawSelector as Hex);

  return (
    <div
      className={[classNames?.root, className].filter(Boolean).join(" ") || undefined}
      style={{ ...containerStyle, ...style }}
    >
      {!hideHeader && (
        <div className={classNames?.header} style={headerStyle}>
          <span className={classNames?.typeBadge} style={typeBadgeStyle(frame.type)}>
            {frame.type}
          </span>
          <span className={classNames?.fromAddress} style={{ color: MUTED_TEXT }}>
            {truncateAddress(frame.from)}
          </span>
          <span
            style={{
              color: SUBTLE_TEXT,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {arrowIcon}
          </span>
          <span className={classNames?.toAddress} style={{ color: NEUTRAL_TEXT }}>
            {frame.to === null ? "(create)" : truncateAddress(frame.to)}
          </span>
        </div>
      )}

      {frame.error && (
        <div
          className={classNames?.errorBanner}
          style={{
            background: ERROR_BG,
            color: ERROR_TEXT,
            padding: "6px 10px",
            borderRadius: "4px",
            marginBottom: "8px",
            fontSize: "12px",
          }}
        >
          {frame.error}
          {frame.revertReason && (
            <span style={{ marginLeft: "8px", opacity: 0.85 }}>
              — {frame.revertReason}
            </span>
          )}
        </div>
      )}

      <MetaGrid
        frame={frame}
        selector={selector}
        valueSymbol={valueSymbol}
        classNames={classNames}
      />

      {frame.functionName && (
        <>
          <div className={classNames?.sectionTitle} style={sectionTitleStyle}>
            Function
          </div>
          <div style={{ color: NEUTRAL_TEXT }}>{frame.functionName}</div>
        </>
      )}

      <div className={classNames?.sectionTitle} style={sectionTitleStyle}>
        Input
      </div>
      <code className={classNames?.rawHex} style={rawHexStyle}>
        {shortHex(frame.input)}
      </code>
      {frame.decodedInput && frame.decodedInput.length > 0 && (
        <DecodedParams params={frame.decodedInput} classNames={classNames} />
      )}

      {frame.output !== "0x" && (
        <>
          <div className={classNames?.sectionTitle} style={sectionTitleStyle}>
            Output
          </div>
          <code className={classNames?.rawHex} style={rawHexStyle}>
            {shortHex(frame.output)}
          </code>
        </>
      )}
      {frame.decodedOutput && frame.decodedOutput.length > 0 && (
        <DecodedParams params={frame.decodedOutput} classNames={classNames} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface MetaGridProps {
  frame: TraceFrame;
  selector: Hex | null;
  valueSymbol: string;
  classNames?: FrameDetailPanelClassNames;
}

function MetaGrid({
  frame,
  selector,
  valueSymbol,
  classNames,
}: MetaGridProps): React.JSX.Element {
  return (
    <div className={classNames?.metaGrid} style={metaGridStyle}>
      <MetaCell
        label="gas used"
        value={`${formatGas(frame.gasUsed)} / ${formatGas(frame.gas)}`}
        classNames={classNames}
      />
      {frame.value > 0n && (
        <MetaCell
          label="value"
          value={`${formatWei(frame.value)} ${valueSymbol}`}
          classNames={classNames}
        />
      )}
      {selector && (
        <MetaCell label="selector" value={selector} classNames={classNames} />
      )}
      <MetaCell label="depth" value={String(frame.depth)} classNames={classNames} />
      <MetaCell
        label="children"
        value={String(frame.children.length)}
        classNames={classNames}
      />
    </div>
  );
}

interface MetaCellProps {
  label: string;
  value: string;
  classNames?: FrameDetailPanelClassNames;
}

function MetaCell({
  label,
  value,
  classNames,
}: MetaCellProps): React.JSX.Element {
  return (
    <div className={classNames?.metaCell}>
      <div
        className={classNames?.metaLabel}
        style={{ color: MUTED_TEXT, fontSize: "11px" }}
      >
        {label}
      </div>
      <div className={classNames?.metaValue} style={{ color: NEUTRAL_TEXT }}>
        {value}
      </div>
    </div>
  );
}

interface DecodedParamsProps {
  params: DecodedParam[];
  classNames?: FrameDetailPanelClassNames;
}

function DecodedParams({
  params,
  classNames,
}: DecodedParamsProps): React.JSX.Element {
  return (
    <div
      className={classNames?.decodedList}
      style={{ marginTop: "4px", paddingLeft: "8px" }}
    >
      {params.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className={classNames?.decodedRow}
          style={{ display: "flex", gap: "8px", padding: "1px 0" }}
        >
          <span style={{ color: MUTED_TEXT, minWidth: "100px" }}>
            {p.name} <span style={{ color: SUBTLE_TEXT }}>({p.type})</span>
          </span>
          <span style={{ color: NEUTRAL_TEXT, wordBreak: "break-all" }}>
            {formatParamValue(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatParamValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    return String(value);
  }
}
