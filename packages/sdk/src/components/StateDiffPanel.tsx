import { type CSSProperties, type ReactNode } from "react";
import type { Hex } from "viem";
import type { StateDiff, StorageChange } from "../types.js";
import { formatWei, truncateAddress } from "./formatters.js";
import { ArrowRightIcon } from "../icons/ArrowRightIcon.js";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const POSITIVE_COLOR = "#3fb950"; // received
const NEGATIVE_COLOR = "#f85149"; // sent
const NEUTRAL_TEXT = "#c9d1d9";
const MUTED_TEXT = "#8b949e";
const SUBTLE_TEXT = "#6e7681";

export interface StateDiffPanelClassNames {
  /** Outer wrapper card. */
  root?: string;
  /** Header row (title + count). */
  header?: string;
  /** Container for the list of per-address sections. */
  list?: string;
  /** One section for one address. */
  addressSection?: string;
  /** The address header within a section. */
  addressHeader?: string;
  /** A single field row (balance / nonce / code). */
  fieldRow?: string;
  /** The field name label (e.g. "balance"). */
  fieldLabel?: string;
  /** The "before" value cell. */
  beforeValue?: string;
  /** The "after" value cell. */
  afterValue?: string;
  /** The signed-delta indicator (e.g. "+0.5 PLS"). */
  delta?: string;
  /** Storage-changes sub-list. */
  storageList?: string;
  /** One storage change row. */
  storageRow?: string;
  /** The empty-state container. */
  empty?: string;
}

export interface StateDiffPanelProps {
  /** Per-address state changes to render. */
  diffs: StateDiff[];
  /** Optional click handler — fired with the clicked address row. */
  onSelectAddress?: (diff: StateDiff) => void;
  /** Hide the header (title + count). */
  hideHeader?: boolean;
  /** Symbol shown alongside balance changes. Default: "PLS". */
  valueSymbol?: string;
  /** Message shown when `diffs` is empty. Default: "No state changes." */
  emptyMessage?: string;
  /**
   * Glyph rendered between each before and after value. Defaults to the
   * built-in `ArrowRightIcon`.
   */
  arrowIcon?: ReactNode;
  /** Per-slot class names for theming. */
  classNames?: StateDiffPanelClassNames;
  /** Inline style on the root element. */
  style?: CSSProperties;
  /** className on the root element (in addition to classNames.root). */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signedDelta(before: bigint, after: bigint): bigint {
  return after - before;
}

function formatSigned(delta: bigint, symbol: string): string {
  if (delta === 0n) return `0 ${symbol}`;
  const sign = delta > 0n ? "+" : "-";
  const abs = delta < 0n ? -delta : delta;
  return `${sign}${formatWei(abs)} ${symbol}`;
}

function shortHex(hex: Hex): string {
  if (hex.length <= 18) return hex;
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Styles (defaults; user can override via classNames)
// ---------------------------------------------------------------------------

const containerStyle: CSSProperties = {
  padding: "12px 16px",
  background: "rgba(13, 17, 23, 0.4)",
  borderRadius: "8px",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontSize: "13px",
};

const sectionStyle: CSSProperties = {
  borderTop: "1px solid rgba(139, 148, 158, 0.15)",
  padding: "8px 0",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "2px 0",
};

const arrowStyle: CSSProperties = {
  color: SUBTLE_TEXT,
  display: "inline-flex",
  alignItems: "center",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders an array of `StateDiff` entries (one per affected address) as a
 * grouped, before/after view with signed balance deltas, nonce bumps, code
 * changes, and per-slot storage changes.
 */
export function StateDiffPanel({
  diffs,
  onSelectAddress,
  hideHeader,
  valueSymbol = "PLS",
  emptyMessage = "No state changes.",
  arrowIcon = <ArrowRightIcon size={12} />,
  classNames,
  style,
  className,
}: StateDiffPanelProps): React.JSX.Element {
  // Sort by address for deterministic order.
  const sorted = [...diffs].sort((a, b) => (a.address < b.address ? -1 : 1));

  return (
    <div
      className={[classNames?.root, className].filter(Boolean).join(" ") || undefined}
      style={{ ...containerStyle, ...style }}
    >
      {!hideHeader && (
        <div
          className={classNames?.header}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "8px",
          }}
        >
          <strong style={{ color: NEUTRAL_TEXT }}>State changes</strong>
          <span style={{ color: MUTED_TEXT, fontSize: "12px" }}>
            {sorted.length} {sorted.length === 1 ? "address" : "addresses"}
          </span>
        </div>
      )}

      {sorted.length === 0 ? (
        <div
          className={classNames?.empty}
          style={{ color: MUTED_TEXT, padding: "8px 0" }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div className={classNames?.list}>
          {sorted.map((diff) => (
            <AddressSection
              key={diff.address}
              diff={diff}
              valueSymbol={valueSymbol}
              onSelectAddress={onSelectAddress}
              arrowIcon={arrowIcon}
              classNames={classNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-address section
// ---------------------------------------------------------------------------

interface AddressSectionProps {
  diff: StateDiff;
  valueSymbol: string;
  onSelectAddress?: (diff: StateDiff) => void;
  arrowIcon: ReactNode;
  classNames?: StateDiffPanelClassNames;
}

function AddressSection({
  diff,
  valueSymbol,
  onSelectAddress,
  arrowIcon,
  classNames,
}: AddressSectionProps): React.JSX.Element {
  const balanceChanged =
    diff.balanceBefore !== undefined && diff.balanceAfter !== undefined;
  const nonceChanged =
    diff.nonceBefore !== undefined &&
    diff.nonceAfter !== undefined &&
    diff.nonceBefore !== diff.nonceAfter;
  const codeChanged =
    diff.codeBefore !== undefined &&
    diff.codeAfter !== undefined &&
    diff.codeBefore !== diff.codeAfter;

  return (
    <div
      className={classNames?.addressSection}
      style={{ ...sectionStyle, cursor: onSelectAddress ? "pointer" : "default" }}
      onClick={onSelectAddress ? () => onSelectAddress(diff) : undefined}
    >
      <div
        className={classNames?.addressHeader}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontWeight: 600,
          color: NEUTRAL_TEXT,
          marginBottom: "4px",
        }}
      >
        {truncateAddress(diff.address)}
      </div>

      {balanceChanged && (
        <BalanceRow
          before={diff.balanceBefore!}
          after={diff.balanceAfter!}
          symbol={valueSymbol}
          arrowIcon={arrowIcon}
          classNames={classNames}
        />
      )}

      {nonceChanged && (
        <FieldRow
          label="nonce"
          before={String(diff.nonceBefore)}
          after={String(diff.nonceAfter)}
          arrowIcon={arrowIcon}
          classNames={classNames}
        />
      )}

      {codeChanged && (
        <FieldRow
          label="code"
          before={shortHex(diff.codeBefore!)}
          after={shortHex(diff.codeAfter!)}
          arrowIcon={arrowIcon}
          classNames={classNames}
        />
      )}

      {diff.storage.length > 0 && (
        <StorageList
          changes={diff.storage}
          arrowIcon={arrowIcon}
          classNames={classNames}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

interface FieldRowProps {
  label: string;
  before: string;
  after: string;
  arrowIcon: ReactNode;
  classNames?: StateDiffPanelClassNames;
}

function FieldRow({
  label,
  before,
  after,
  arrowIcon,
  classNames,
}: FieldRowProps): React.JSX.Element {
  return (
    <div className={classNames?.fieldRow} style={fieldRowStyle}>
      <span
        className={classNames?.fieldLabel}
        style={{ color: MUTED_TEXT, minWidth: "60px" }}
      >
        {label}
      </span>
      <span className={classNames?.beforeValue} style={{ color: NEUTRAL_TEXT }}>
        {before}
      </span>
      <span style={arrowStyle}>{arrowIcon}</span>
      <span className={classNames?.afterValue} style={{ color: NEUTRAL_TEXT }}>
        {after}
      </span>
    </div>
  );
}

interface BalanceRowProps {
  before: bigint;
  after: bigint;
  symbol: string;
  arrowIcon: ReactNode;
  classNames?: StateDiffPanelClassNames;
}

function BalanceRow({
  before,
  after,
  symbol,
  arrowIcon,
  classNames,
}: BalanceRowProps): React.JSX.Element {
  const delta = signedDelta(before, after);
  const deltaColor =
    delta > 0n ? POSITIVE_COLOR : delta < 0n ? NEGATIVE_COLOR : SUBTLE_TEXT;
  return (
    <div className={classNames?.fieldRow} style={fieldRowStyle}>
      <span
        className={classNames?.fieldLabel}
        style={{ color: MUTED_TEXT, minWidth: "60px" }}
      >
        balance
      </span>
      <span className={classNames?.beforeValue} style={{ color: NEUTRAL_TEXT }}>
        {formatWei(before)} {symbol}
      </span>
      <span style={arrowStyle}>{arrowIcon}</span>
      <span className={classNames?.afterValue} style={{ color: NEUTRAL_TEXT }}>
        {formatWei(after)} {symbol}
      </span>
      <span className={classNames?.delta} style={{ color: deltaColor }}>
        {formatSigned(delta, symbol)}
      </span>
    </div>
  );
}

interface StorageListProps {
  changes: StorageChange[];
  arrowIcon: ReactNode;
  classNames?: StateDiffPanelClassNames;
}

function StorageList({
  changes,
  arrowIcon,
  classNames,
}: StorageListProps): React.JSX.Element {
  return (
    <div
      className={classNames?.storageList}
      style={{ marginTop: "4px", paddingLeft: "16px" }}
    >
      <div
        style={{
          color: MUTED_TEXT,
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "2px",
        }}
      >
        storage ({changes.length})
      </div>
      {changes.map((c, i) => (
        <div
          key={`${c.slot}-${i}`}
          className={classNames?.storageRow}
          style={fieldRowStyle}
        >
          <span style={{ color: SUBTLE_TEXT, minWidth: "60px" }}>
            {shortHex(c.slot)}
          </span>
          <span style={{ color: NEUTRAL_TEXT }}>{shortHex(c.before)}</span>
          <span style={arrowStyle}>{arrowIcon}</span>
          <span style={{ color: NEUTRAL_TEXT }}>{shortHex(c.after)}</span>
        </div>
      ))}
    </div>
  );
}
