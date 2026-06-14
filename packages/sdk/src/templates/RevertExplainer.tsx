import { type CSSProperties, type ReactNode } from "react";
import type { CallType, TraceFrame } from "../types.js";
import { walkCallTree } from "../traversal/walkCallTree.js";
import {
  getFunctionSelector,
  truncateAddress,
} from "../components/formatters.js";
import { CheckIcon } from "../icons/CheckIcon.js";
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
const ERROR_BG = "rgba(248, 81, 73, 0.14)";
const ERROR_BORDER = "rgba(248, 81, 73, 0.4)";
const ERROR_TEXT = "#f85149";
const SUCCESS_TEXT = "#3fb950";

export interface RevertExplainerClassNames {
  /** Outer wrapper. */
  root?: string;
  /** The big revert-reason banner. */
  reasonBanner?: string;
  /** Container for the call chain. */
  chain?: string;
  /** One step in the call chain. */
  chainStep?: string;
  /** The arrow between chain steps. */
  chainArrow?: string;
  /** Indicator on the final (reverting) step. */
  revertingStep?: string;
  /** The success message body when no revert. */
  successBody?: string;
}

export interface RevertExplainerProps {
  /** Root of the trace. */
  frame: TraceFrame;
  /** Custom message when no revert occurred. */
  successMessage?: string;
  /**
   * Icon shown beside the success message when nothing reverted. Defaults to
   * the built-in `CheckIcon`.
   */
  successIcon?: ReactNode;
  /**
   * Glyph between steps in the revert breadcrumb chain. Defaults to the
   * built-in `ArrowRightIcon`.
   */
  arrowIcon?: ReactNode;
  /** Per-slot class names. */
  classNames?: RevertExplainerClassNames;
  /** Inline style on root. */
  style?: CSSProperties;
  /** className on root. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Path-finding helper
// ---------------------------------------------------------------------------

/**
 * Walk the tree and return the ancestor chain from root to the deepest
 * frame that reverted. Empty array if nothing reverted.
 */
function findRevertPath(root: TraceFrame): TraceFrame[] {
  let bestPath: TraceFrame[] = [];
  let bestDepth = -1;
  const stack: TraceFrame[] = [];

  walkCallTree(root, {
    enter(frame, depth) {
      stack.push(frame);
      if ((frame.error || frame.revertReason) && depth > bestDepth) {
        bestPath = [...stack];
        bestDepth = depth;
      }
    },
    exit() {
      stack.pop();
    },
  });

  return bestPath;
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

const reasonBannerStyle: CSSProperties = {
  background: ERROR_BG,
  border: `1px solid ${ERROR_BORDER}`,
  borderRadius: "6px",
  padding: "10px 12px",
  marginBottom: "10px",
};

const reasonHeadingStyle: CSSProperties = {
  color: ERROR_TEXT,
  fontWeight: 600,
  fontSize: "11px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  marginBottom: "4px",
};

const reasonTextStyle: CSSProperties = {
  color: NEUTRAL_TEXT,
  fontSize: "14px",
  wordBreak: "break-word",
};

const chipStyle: CSSProperties = {
  padding: "1px 5px",
  borderRadius: "3px",
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  background: "rgba(0,0,0,0.2)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact "why did this revert" view. Locates the innermost reverting
 * frame, surfaces its revert reason prominently, and shows the breadcrumb
 * chain from the root frame down to the reverter so the cause is easy to
 * trace back.
 *
 * For a non-reverted trace, renders a success message instead — the
 * component is safe to drop in unconditionally.
 */
export function RevertExplainer({
  frame,
  successMessage = "Transaction completed without revert.",
  successIcon = <CheckIcon size={14} />,
  arrowIcon = <ArrowRightIcon size={12} />,
  classNames,
  style,
  className,
}: RevertExplainerProps): React.JSX.Element {
  const path = findRevertPath(frame);

  return (
    <div
      className={[classNames?.root, className].filter(Boolean).join(" ") || undefined}
      style={{ ...containerStyle, ...style }}
    >
      {path.length === 0 ? (
        <div
          className={classNames?.successBody}
          style={{
            color: SUCCESS_TEXT,
            padding: "6px 0",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {successIcon} {successMessage}
        </div>
      ) : (
        <RevertedBody path={path} arrowIcon={arrowIcon} classNames={classNames} />
      )}
    </div>
  );
}

interface RevertedBodyProps {
  path: TraceFrame[];
  arrowIcon: ReactNode;
  classNames?: RevertExplainerClassNames;
}

function RevertedBody({
  path,
  arrowIcon,
  classNames,
}: RevertedBodyProps): React.JSX.Element {
  const reverter = path[path.length - 1]!;
  // findRevertPath only includes frames where `error || revertReason` is
  // truthy, so at least one of these is set by construction.
  const reason = (reverter.revertReason || reverter.error) as string;

  return (
    <>
      <div className={classNames?.reasonBanner} style={reasonBannerStyle}>
        <div style={reasonHeadingStyle}>Reverted</div>
        <div style={reasonTextStyle}>{reason}</div>
      </div>

      <div
        className={classNames?.chain}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "6px",
          color: MUTED_TEXT,
        }}
      >
        {path.map((f, i) => {
          const isLast = i === path.length - 1;
          return (
            <span
              key={i}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              {i > 0 && (
                <span
                  className={classNames?.chainArrow}
                  style={{
                    color: SUBTLE_TEXT,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  {arrowIcon}
                </span>
              )}
              <ChainStep
                frame={f}
                isLast={isLast}
                classNames={classNames}
              />
            </span>
          );
        })}
      </div>
    </>
  );
}

interface ChainStepProps {
  frame: TraceFrame;
  isLast: boolean;
  classNames?: RevertExplainerClassNames;
}

function ChainStep({
  frame,
  isLast,
  classNames,
}: ChainStepProps): React.JSX.Element {
  const target = frame.to === null ? "(create)" : truncateAddress(frame.to);
  const selectorRaw = getFunctionSelector(frame.input);
  const selector = selectorRaw === "(fallback)" ? null : selectorRaw;
  const stepClassName =
    [classNames?.chainStep, isLast ? classNames?.revertingStep : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <span
      className={stepClassName}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 6px",
        borderRadius: "4px",
        background: isLast ? ERROR_BG : "transparent",
        color: isLast ? ERROR_TEXT : NEUTRAL_TEXT,
      }}
    >
      <span style={{ ...chipStyle, color: CALL_TYPE_COLORS[frame.type] }}>
        {frame.type}
      </span>
      <span>{target}</span>
      {selector && <span style={{ color: SUBTLE_TEXT }}>{selector}</span>}
    </span>
  );
}
