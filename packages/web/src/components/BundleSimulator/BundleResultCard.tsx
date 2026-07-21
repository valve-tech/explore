import type { SimulationResult } from "../../types";
import { StatusBadge } from "../primitives/StatusBadge";

export function BundleResultCard({
  result,
  index,
}: {
  result: SimulationResult;
  index: number;
}) {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
    >
      <div className="flex items-center justify-between mb-3">
        <h4
          className="text-sm font-semibold theme-text"
        >
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full mr-2 text-[10px] font-bold"
            style={{
              backgroundColor: result.success
                ? "var(--color-success-muted)"
                : "var(--color-danger-muted)",
              color: result.success
                ? "var(--color-success)"
                : "var(--color-danger)",
            }}
          >
            {index + 1}
          </span>
          Transaction #{index + 1}
        </h4>
        <StatusBadge success={result.success} size="sm" />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="theme-text-secondary">Gas Estimate</span>
          <span className="theme-mono theme-text"
          >
            {result.gasEstimate != null ? BigInt(result.gasEstimate).toLocaleString() : "—"}
          </span>
        </div>

        {result.returnData && result.returnData !== "0x" && (
          <div>
            <span
              className="text-xs block mb-1 theme-text-secondary"
            >
              Return Data
            </span>
            <span
              className="text-xs break-all block theme-mono theme-text"
            >
              {result.returnData}
            </span>
          </div>
        )}

        {result.revertReason && (
          <div
            className="p-2 rounded-md mt-2 theme-danger-bg"
          >
            <span
              className="text-xs font-medium block mb-0.5 theme-danger"
            >
              Revert Reason
            </span>
            <span
              className="text-xs break-all theme-mono theme-text"
            >
              {result.revertReason}
            </span>
          </div>
        )}

        {result.decodedCall && (
          <div className="mt-2">
            <span
              className="text-xs block mb-1 theme-text-secondary"
            >
              Function Call
            </span>
            <span
              className="text-xs px-2 py-1 rounded inline-block theme-mono theme-accent-bg theme-accent"
            >
              {result.decodedCall.functionName}(
              {result.decodedCall.params.map((p) => p.type).join(", ")})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
