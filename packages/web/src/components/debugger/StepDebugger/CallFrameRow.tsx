import { useState } from "react";
import { Icon } from "@iconify/react";
import { Tooltip } from "../../primitives/Tooltip";
import { lookupWellKnown } from "../../../lib/wellKnownSignatures";
import { bestMatchSignature } from "./callTreeHelpers";
import { CALL_TYPE_BORDER } from "./theme";
import { TreeNode, isRowExpanded, type TreeShared } from "./TreeNode";
import { nodeKey, type ExecNode } from "./executionScopes";

// Short, uppercase call-type tag shown inline on each row (Tenderly-style),
// colored by the call kind. Keeps the tree scannable without a hover tooltip.
const CALL_TYPE_TAG: Record<string, string> = {
  CALL: "CALL",
  STATICCALL: "STATIC",
  DELEGATECALL: "DELEGATE",
  CALLCODE: "CALLCODE",
  CREATE: "CREATE",
  CREATE2: "CREATE2",
};

function formatGas(hex?: string): string | null {
  if (!hex) return null;
  try {
    const n = BigInt(hex);
    if (n === 0n) return null;
    return n.toLocaleString();
  } catch {
    return null;
  }
}

/**
 * Render one external call frame (a `call` node of the unified execution tree).
 * Its children — sub-call frames and the internal functions it executed — are
 * rendered back through TreeNode, so calls and functions nest freely.
 */
export function CallFrameRow({
  node,
  depth,
  shared,
}: {
  node: Extract<ExecNode, { kind: "call" }>;
  depth: number;
  shared: TreeShared;
}) {
  const { onJumpTo, signatureMap, contractNames, abiSelectors, onSelect, selectedKey, onSelectKey, expandedOverrides, onToggleExpand, onExpand } = shared;
  const frame = node.frame;
  const stepIndex = node.startStep;
  const key = nodeKey(node);

  const expanded = isRowExpanded(key, depth, expandedOverrides);
  const [hovered, setHovered] = useState(false);
  const hasChildren = node.children.length > 0;

  const selector = frame.input?.length >= 10 ? frame.input.slice(0, 10).toLowerCase() : "";

  const contractName = frame.to ? contractNames[frame.to.toLowerCase()] : null;
  // Authoritative name from the callee's verified ABI, if we have it. This is
  // exact — no 4byte hash collisions, and it covers custom selectors the
  // public directory doesn't know.
  const abiName = frame.to && selector
    ? abiSelectors[frame.to.toLowerCase()]?.[selector]
    : undefined;
  const wellKnown = selector ? lookupWellKnown(selector) : undefined;
  // 4byte fallback: disambiguate collisions by calldata length rather than
  // blindly taking the first candidate (which is often spam like
  // `_SIMONdotBLACK_` or `join_tg_invmru_…`).
  const sigMatch = selector
    ? bestMatchSignature(signatureMap[selector] ?? [], frame.input ?? "0x")
    : undefined;
  const resolvedSig = wellKnown?.signature ?? sigMatch;
  // Empty calldata = a plain value transfer, which the EVM routes to the
  // callee's receive() (value sent) or fallback() — not an unknown function.
  const hasValue = !!frame.value && frame.value !== "0x0" && frame.value !== "0";
  const noCalldataLabel = hasValue ? "receive" : "fallback";
  const funcName =
    abiName ??
    (resolvedSig
      ? resolvedSig.split("(")[0]!
      : selector || noCalldataLabel);
  const displayLabel = contractName ?? wellKnown?.interface ?? null;

  // Prefer the dispatched-function step (resolved from the callee's own source
  // map) so the source pane lands on the real function body. Only when there's
  // no dispatch target — value transfers (receive/fallback) and unverified
  // callees, whose bodies the optimizer leaves unmapped — fall back to the
  // frame entry plus a name+contract hint. The handler does the (pure) source
  // search synchronously at click time, so a missed lookup raises a visible
  // error rather than briefly rendering the entry-step source-map location.
  const jumpStep = node.dispatchStep ?? stepIndex;
  const jumpHint =
    node.dispatchStep === undefined && funcName !== "???"
      ? { funcName, contractAddr: frame.to }
      : undefined;

  const isSelected = selectedKey === key;
  // Flat rows (Tenderly-style): selection + hover + error drive the background;
  // call type is conveyed by the inline tag, not a chunky colored left border.
  const bgColor = isSelected
    ? "var(--color-accent-muted)"
    : frame.error
      ? "rgba(248, 81, 73, 0.06)"
      : hovered
        ? "var(--color-bg-secondary)"
        : "transparent";
  const typeColor = CALL_TYPE_BORDER[frame.type]?.replace(/0\.4\)/, "0.9)") ?? "var(--color-text-muted)";
  const typeTag = CALL_TYPE_TAG[frame.type];
  const gas = formatGas(frame.gasUsed);

  // Parse value from hex wei to PLS
  const valuePLS = (() => {
    if (!frame.value || frame.value === "0x0" || frame.value === "0") return null;
    try {
      const wei = BigInt(frame.value);
      if (wei === 0n) return null;
      const whole = wei / 10n ** 18n;
      const frac = wei % 10n ** 18n;
      if (whole > 0n) return `${whole}.${frac.toString().padStart(18, "0").slice(0, 4)}`;
      // Small amounts: show more decimals
      const fracStr = frac.toString().padStart(18, "0");
      const firstNonZero = fracStr.search(/[^0]/);
      return `0.${fracStr.slice(0, Math.max(firstNonZero + 4, 4))}`;
    } catch {
      return null;
    }
  })();

  return (
    <div>
      <div
        data-node-key={key}
        className={`flex items-center gap-tight pr-2 py-1 cursor-pointer text-xs relative whitespace-nowrap theme-mono${isSelected ? " bs-l-accent-in" : ""}`}
        onClick={() => { onJumpTo(jumpStep, jumpHint); onSelect?.(frame); onSelectKey?.(key); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          backgroundColor: bgColor,
        }}
      >
        {/* Depth guide lines — one faint vertical rule per ancestor level. */}
        {Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="self-stretch flex-shrink-0 bs-l-in-muted"
            style={{ width: "14px", marginLeft: i === 0 ? "6px" : 0 }}
          />
        ))}

        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(key, !expanded); }}
            className="w-4 flex items-center justify-center flex-shrink-0 theme-text-muted"
          >
            <Icon icon={expanded ? "heroicons:chevron-down" : "heroicons:chevron-right"} className="w-3 h-3" />
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" style={{ marginLeft: depth === 0 ? "6px" : 0 }} />
        )}

        {typeTag && (
          <Tooltip label={frame.type} className="flex-shrink-0">
            <span
              className="flex-shrink-0 text-[9px] font-semibold tracking-wide px-1 py-0.5"
              style={{ color: typeColor, boxShadow: `inset 0 0 0 1px ${typeColor}` }}
            >
              {typeTag}
            </span>
          </Tooltip>
        )}

        {displayLabel && (
          <>
            {frame.to ? (
              <Tooltip label={frame.to}>
                <span className={contractName ? "theme-accent" : "theme-text-secondary"}>
                  {displayLabel}
                </span>
              </Tooltip>
            ) : (
              <span className={contractName ? "theme-accent" : "theme-text-secondary"}>
                {displayLabel}
              </span>
            )}
            <span className="theme-text-muted">.</span>
          </>
        )}

        {frame.to ? (
          <Tooltip label={frame.to}>
            <span className={`font-semibold ${frame.error ? "theme-danger" : "theme-text"}`}>
              {funcName}
            </span>
          </Tooltip>
        ) : (
          <span className={`font-semibold ${frame.error ? "theme-danger" : "theme-text"}`}>
            {funcName}
          </span>
        )}

        {frame.error && (
          <Tooltip label={frame.error} className="flex-shrink-0">
            <span
              className="flex-shrink-0 px-1 theme-danger"
              style={{ fontSize: "9px", fontWeight: 700 }}
            >
              REVERT
            </span>
          </Tooltip>
        )}

        {/* Always rendered (when expandable) so it reserves its slot — toggling
            on hover would change the row width and make the tree thrash. We fade
            it in and disable pointer events instead. */}
        {onExpand && (
          <Tooltip label="Show this frame's opcodes" className="flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpand(
                  frame,
                  stepIndex,
                  `${displayLabel ? `${displayLabel}.` : ""}${funcName}`,
                );
              }}
              className="flex-shrink-0 flex items-center transition-opacity theme-text-muted"
              style={{
                opacity: hovered ? 1 : 0,
                pointerEvents: hovered ? "auto" : "none",
              }}
              aria-hidden={!hovered}
              tabIndex={hovered ? 0 : -1}
            >
              <Icon icon="heroicons:arrows-pointing-out" className="w-3 h-3" />
            </button>
          </Tooltip>
        )}

        {valuePLS && (
          <span className="flex-shrink-0 theme-warning">
            {valuePLS} PLS
          </span>
        )}

        {/* Gas used, right-aligned — the at-a-glance cost per call. */}
        {gas && (
          <span className="ml-auto flex-shrink-0 pl-3 theme-text-muted">
            {gas}
          </span>
        )}

        {hovered && (
          <div
            className="absolute left-full ml-2 z-20 px-3 py-2 shadow-lg text-xs whitespace-nowrap theme-secondary-bg theme-text theme-mono"
            style={{
              boxShadow: "0 0 0 1px var(--color-border-default)",
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <div className="theme-danger">{frame.type}</div>
            {resolvedSig && <div>{resolvedSig}</div>}
            {frame.to && <div className="theme-text-muted">{frame.to}</div>}
            <div className="theme-text-muted">gas: {frame.gasUsed}</div>
            {frame.error && <div className="theme-danger">error: {frame.error}</div>}
          </div>
        )}
      </div>

      {/* Children — sub-call frames and internal functions, already interleaved
          in execution order by the tree builder. */}
      {expanded && node.children.map((child, i) => (
        <TreeNode key={i} node={child} depth={depth + 1} shared={shared} />
      ))}
    </div>
  );
}
