import { Icon } from "@iconify/react";
import type { SimulationResult } from "../../types";

export function LoadingPanel({ count }: { count: number }) {
  return (
    <div
      className="rounded-lg bs p-8 flex flex-col items-center justify-center text-center theme-card-bg"
    >
      <div className="spinner mb-4" />
      <p className="text-sm theme-text-secondary">
        Simulating {count} transaction{count !== 1 ? "s" : ""}...
      </p>
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg p-2 sm:p-4 theme-card-bg"
      style={{ borderColor: "var(--color-danger)" }}
    >
      <div className="flex items-start gap-row">
        <Icon
          icon="heroicons:exclamation-circle"
          className="w-5 h-5 mt-0.5 shrink-0 theme-danger"
        />
        <div>
          <h3
            className="text-sm font-semibold mb-1 theme-danger"
          >
            Bundle Simulation Error
          </h3>
          <p
            className="text-sm break-all theme-mono theme-text-secondary"
          >
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export function EmptyPanel() {
  return (
    <div
      className="rounded-lg bs p-8 flex flex-col items-center justify-center text-center min-h-[300px] theme-card-bg"
    >
      <Icon
        icon="heroicons:calculator"
        className="w-12 h-12 mb-3"
        style={{ color: "var(--color-border-default)" }}
      />
      <h3
        className="text-sm font-medium mb-1 theme-text-secondary"
      >
        No Bundle Results
      </h3>
      <p className="text-xs theme-text-muted">
        Add transactions and simulate to see sequential results.
      </p>
    </div>
  );
}

/**
 * Sum the gas a bundle is KNOWN to use, and say how much of it is unknown.
 *
 * `gasEstimate` is `null` whenever a call reverts before the node produces a
 * figure. Folding that into the sum as `0n` — which this did — turns a missing
 * measurement into a confident number: a bundle where three of five
 * transactions reverted reported the gas of the two that worked, labelled
 * "total gas", with nothing to say the rest were never counted.
 *
 * A total that omits rows is not a total. The count comes back with it so the
 * caller can mark the figure as a floor rather than state it as a fact.
 */
export function summariseBundleGas(results: SimulationResult[]): {
  known: bigint;
  unknown: number;
  isComplete: boolean;
} {
  let known = 0n;
  let unknown = 0;
  for (const r of results) {
    if (r.gasEstimate == null) {
      unknown += 1;
      continue;
    }
    try {
      known += BigInt(r.gasEstimate);
    } catch {
      // A non-numeric estimate is a missing one, not a zero.
      unknown += 1;
    }
  }
  return { known, unknown, isComplete: unknown === 0 };
}

export function SummaryBar({ results }: { results: SimulationResult[] }) {
  const succeeded = results.filter((r) => r.success).length;
  const reverted = results.length - succeeded;
  const gas = summariseBundleGas(results);

  return (
    <div
      className="rounded-lg bs p-3 flex items-center justify-between theme-card-bg"
    >
      <div className="flex items-center gap-4 text-xs">
        <span className="theme-text-secondary">
          Total:{" "}
          <strong className="theme-text">
            {results.length} txs
          </strong>
        </span>
        <span className="theme-success">
          {succeeded} succeeded
        </span>
        {reverted > 0 && (
          <span className="theme-danger">
            {reverted} reverted
          </span>
        )}
      </div>
      <span
        className="text-xs theme-mono theme-text-muted"
      >
        {gas.isComplete ? "" : "≥ "}
        {gas.known.toLocaleString()} total gas
        {gas.unknown > 0 && (
          <span className="theme-text-muted">
            {" "}
            ({gas.unknown} not measured)
          </span>
        )}
      </span>
    </div>
  );
}
