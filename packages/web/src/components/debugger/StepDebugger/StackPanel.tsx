import { CollapsiblePanel } from "./CollapsiblePanel";
import { Tooltip } from "../../primitives/Tooltip";
import { formatWord, truncateWord } from "./format";

/** Collapsible panel showing the EVM stack at the current step.
 *  Words that changed since the previous step (indices in `changedIndices`)
 *  are highlighted with the accent color. */
export function StackPanel({
  stack,
  changedIndices,
  inputIndices,
  loading,
}: {
  stack: string[];
  changedIndices: Set<number>;
  /** Stack indices the current opcode consumes — flagged as inputs. */
  inputIndices?: Set<number>;
  loading?: boolean;
}) {
  return (
    <CollapsiblePanel title="Stack" count={stack.length} defaultOpen={false}>
      <div className="overflow-y-auto px-3 py-1" style={{ maxHeight: "200px" }}>
        {loading ? (
          <div className="py-4 text-xs text-center theme-text-muted">Loading stack…</div>
        ) : stack.length === 0 ? (
          <div className="py-4 text-xs text-center theme-text-muted">Stack is empty</div>
        ) : (
          [...stack].reverse().map((word, i) => {
            const actualIndex = stack.length - 1 - i;
            const changed = changedIndices.has(actualIndex);
            const isInput = inputIndices?.has(actualIndex) ?? false;
            return (
              <div
                key={i}
                className="flex items-center text-xs py-0.5"
                style={{
                  fontFamily: "var(--font-mono)",
                  // Inputs the current op consumes get a warning-tinted rail.
                  boxShadow: isInput ? "inset 2px 0 0 0 var(--color-warning)" : undefined,
                  paddingLeft: isInput ? "4px" : undefined,
                }}
              >
                <span className="w-8 text-right mr-2 flex-shrink-0 theme-text-muted">{i}</span>
                <Tooltip label={formatWord(word)} className="truncate min-w-0">
                  <span
                    className="truncate"
                    style={{
                      color: isInput
                        ? "var(--color-warning)"
                        : changed
                          ? "var(--color-accent)"
                          : "var(--color-text-primary)",
                      fontWeight: changed || isInput ? 600 : 400,
                    }}
                  >
                    {truncateWord(word)}
                  </span>
                </Tooltip>
                {isInput && (
                  <span className="ml-auto flex-shrink-0 text-[9px] uppercase tracking-wide theme-warning">
                    in
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </CollapsiblePanel>
  );
}
