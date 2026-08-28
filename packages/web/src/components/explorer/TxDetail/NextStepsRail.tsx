import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { TransactionDetails } from "../../../api/explorer";
import { Tooltip } from "../../primitives/Tooltip";
import { nextStepsFor, hasFailedTransferFrom, type NextStep } from "./nextSteps";

interface NextStepsRailProps {
  tx: TransactionDetails;
  chainId: number;
  /** Decoded function name for the top-level call, already on the page. */
  functionName: string | null;
}

/**
 * Reads the transaction's real outcome and offers what to do next — a revert
 * points at the debugger, a failed `transferFrom` adds the sender, a
 * successful swap offers a fork-replay. Renders nothing when `nextStepsFor`
 * has no suggestion it can back with a real link.
 *
 * **One row of buttons, no card and no heading.** This was a titled card of
 * stacked sentence-length links: four of them ran taller than the transaction
 * summary they followed, and pushed the logs and the call trace — the things
 * the reader opened the page for — below the fold. Suggestions are not the
 * content of a transaction page, so they get the space a toolbar gets. The
 * button says what it does; the tooltip carries the sentence.
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
    <div className="flex flex-wrap items-center gap-inline">
      {steps.map((step) => (
        <StepButton key={step.id} step={step} />
      ))}
    </div>
  );
}

function StepButton({ step }: { step: NextStep }) {
  // The full sentence still reaches assistive tech and the pointer — it moved
  // out of the layout, it did not get dropped.
  const explanation = `${step.label} — ${step.sub}`;

  return (
    <Tooltip label={explanation}>
      <Link
        to={step.to}
        aria-label={explanation}
        className="flex items-center gap-inline px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          backgroundColor: step.primary
            ? "var(--color-accent-muted)"
            : "var(--color-bg-secondary)",
          color: step.primary
            ? "var(--color-accent)"
            : "var(--color-text-secondary)",
          // Outset, never inset. An inset ring eats 1px of the content box; an
          // outset one costs zero layout width, which is why this codebase
          // draws every outline that way.
          boxShadow: step.primary
            ? "0 0 0 1px var(--color-accent)"
            : "0 0 0 1px var(--color-border-muted)",
        }}
      >
        <Icon icon={step.icon} className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {step.short}
      </Link>
    </Tooltip>
  );
}
