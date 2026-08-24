import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { TransactionDetails } from "../../../api/explorer";
import { nextStepsFor, hasFailedTransferFrom } from "./nextSteps";

interface NextStepsRailProps {
  tx: TransactionDetails;
  chainId: number;
  /** Decoded function name for the top-level call, already on the page. */
  functionName: string | null;
}

/**
 * Reads the transaction's real outcome and suggests what to do next — a
 * revert points at the debugger, a failed `transferFrom` adds an allowance
 * check, a successful swap offers a fork-replay. Renders nothing when
 * `nextStepsFor` has no suggestion it can back with a real link.
 */
export function NextStepsRail({ tx, chainId, functionName }: NextStepsRailProps) {
  const steps = nextStepsFor(
    {
      status: tx.status,
      hash: tx.hash,
      fromAddress: tx.from,
      functionName,
      hasFailedTransferFrom: hasFailedTransferFrom(tx.internalTransactions),
    },
    chainId,
  );

  if (steps.length === 0) return null;

  return (
    <div className="card p-2 sm:p-4">
      <div className="text-[10px] uppercase tracking-widest mb-3 theme-text-muted">
        What to do next
      </div>
      <div className="space-y-stack">
        {steps.map((step) => (
          <Link
            key={step.id}
            to={step.to}
            className="block p-2 sm:p-4 transition-colors"
            style={{
              backgroundColor: step.primary
                ? "var(--color-accent-muted)"
                : "var(--color-bg-secondary)",
              // Outset, never inset. An inset ring eats 1px of the content
              // box; an outset one costs zero layout width, which is why
              // this codebase draws every outline that way.
              boxShadow: step.primary
                ? "0 0 0 1px var(--color-accent)"
                : "0 0 0 1px var(--color-border-muted)",
            }}
          >
            <div className="flex items-start gap-inline">
              <Icon
                icon={step.icon}
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  step.primary ? "theme-accent" : "theme-text-secondary"
                }`}
                aria-hidden
              />
              <div className="min-w-0">
                <div
                  className={`text-sm font-medium leading-snug mb-1 ${
                    step.primary ? "theme-accent" : "theme-text"
                  }`}
                >
                  {step.label}
                </div>
                <div className="text-xs leading-snug theme-text-muted">
                  {step.sub}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
