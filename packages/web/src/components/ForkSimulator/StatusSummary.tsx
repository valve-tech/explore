import type { ForkSimulationResult } from "../../api/simulate";

interface Props {
  result: ForkSimulationResult;
  onViewContract: (address: string) => void;
  onDebug: (txHash: string) => void;
}

export function StatusSummary({ result, onViewContract, onDebug }: Props) {
  return (
    <div
      className="rounded-lg bs p-2 sm:p-4 flex items-center justify-between theme-card-bg"
    >
      <div className="flex items-center gap-row">
        <span
          className="px-2 py-1 rounded text-xs font-semibold"
          style={{
            backgroundColor: result.success
              ? "rgba(16, 185, 129, 0.15)"
              : "rgba(239, 68, 68, 0.15)",
            color: result.success
              ? "var(--color-success)"
              : "var(--color-danger)",
          }}
        >
          {result.success ? "SUCCESS" : "REVERTED"}
        </span>
        <span
          className="text-sm theme-text-secondary"
        >
          Gas:{" "}
          <span className="theme-mono">
            {Number(result.gasUsed).toLocaleString()}
          </span>
        </span>
        {result.blockNumber > 0 && (
          <span
            className="text-sm theme-text-muted"
          >
            Block: {result.blockNumber.toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex gap-inline">
        {result.contractAddress && (
          <button
            onClick={() => onViewContract(result.contractAddress!)}
            className="text-xs px-3 py-1 rounded theme-accent-bg theme-accent"
          >
            View Contract
          </button>
        )}
        {result.txHash && (
          <button
            onClick={() => onDebug(result.txHash!)}
            className="text-xs px-3 py-1 rounded font-medium"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "#fff",
            }}
          >
            Debug This Tx
          </button>
        )}
      </div>
    </div>
  );
}
