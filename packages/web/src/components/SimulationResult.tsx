import { Icon } from "@iconify/react";
import type { SimulationResult } from "../types";
import { StatusBadge } from "./primitives/StatusBadge";

interface SimulationResultPanelProps {
  result: SimulationResult | null;
  loading: boolean;
  error: string | null;
}

function DataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-tight py-2.5 bs-b-muted last:shadow-none">
      <span className="text-xs font-medium theme-text-secondary">
        {label}
      </span>
      <span className={`text-sm break-all theme-text ${mono ? "theme-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-lg bs p-8 flex flex-col items-center justify-center text-center min-h-[400px] theme-card-bg"
    >
      <Icon
        icon="heroicons:document-chart-bar"
        className="w-16 h-16 mb-4"
        style={{ color: "var(--color-border-default)" }}
      />
      <h3 className="text-sm font-medium mb-1 theme-text-secondary">
        No Simulation Results
      </h3>
      <p className="text-xs theme-text-muted">
        Configure and run a transaction simulation to see results here.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="rounded-lg bs p-8 flex flex-col items-center justify-center text-center min-h-[400px] theme-card-bg"
    >
      <div className="spinner mb-4" />
      <h3 className="text-sm font-medium mb-1 theme-text-secondary">
        Simulating Transaction...
      </h3>
      <p className="text-xs theme-text-muted">
        Running against PulseChain state
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
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
          <h3 className="text-sm font-semibold mb-1 theme-danger">
            Simulation Error
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

export default function SimulationResultPanel({
  result,
  loading,
  error,
}: SimulationResultPanelProps) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!result) return <EmptyState />;

  return (
    <div className="space-y-stack">
      {/* Status card */}
      <div
        className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-sm font-semibold theme-text"
          >
            Simulation Result
          </h2>
          <StatusBadge success={result.success} size="lg" />
        </div>

        <div>
          <DataRow
            label="Gas Estimate"
            value={result.gasEstimate != null ? BigInt(result.gasEstimate).toLocaleString() : "—"}
          />

          {result.returnData && result.returnData !== "0x" && (
            <DataRow label="Return Data (raw)" value={result.returnData} mono />
          )}

          {result.revertReason && (
            <div
              className="mt-3 p-3 rounded-md theme-danger-bg"
            >
              <span
                className="text-xs font-medium block mb-1 theme-danger"
              >
                Revert Reason
              </span>
              <span
                className="text-sm break-all theme-mono theme-text"
              >
                {result.revertReason}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Decoded function call */}
      {result.decodedCall && (
        <div
          className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
        >
          <h3
            className="text-sm font-semibold mb-3 pb-2 bs-b-muted theme-text"
          >
            Decoded Function Call
          </h3>
          <div
            className="px-3 py-2 rounded-md mb-3 text-sm theme-mono theme-accent-bg theme-accent"
          >
            {result.decodedCall.functionName}(
            {result.decodedCall.params.map((p) => p.type).join(", ")})
          </div>
          <div className="space-y-1">
            {result.decodedCall.params.map((param, i) => (
              <div
                key={i}
                className="flex items-start gap-row py-1.5 text-sm"
              >
                <span
                  className="shrink-0 font-medium theme-accent"
                >
                  {param.name || `param${i}`}
                </span>
                <span className="theme-text-muted">
                  ({param.type})
                </span>
                <span
                  className="break-all theme-mono theme-text"
                >
                  {param.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decoded return value */}
      {result.decodedReturn && result.decodedReturn.values.length > 0 && (
        <div
          className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
        >
          <h3
            className="text-sm font-semibold mb-3 pb-2 bs-b-muted theme-text"
          >
            Decoded Return Value
          </h3>
          <div className="space-y-1">
            {result.decodedReturn.values.map((val, i) => (
              <div key={i} className="flex items-start gap-row py-1.5 text-sm">
                <span
                  className="shrink-0 font-medium theme-success"
                >
                  {val.name || `output${i}`}
                </span>
                <span className="theme-text-muted">
                  ({val.type})
                </span>
                <span
                  className="break-all theme-mono theme-text"
                >
                  {val.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event logs */}
      {result.logs && result.logs.length > 0 && (
        <div
          className="rounded-lg bs p-2 sm:p-4 theme-card-bg"
        >
          <h3
            className="text-sm font-semibold mb-3 pb-2 bs-b-muted theme-text"
          >
            Event Logs ({result.logs.length})
          </h3>
          <div className="space-y-3">
            {result.logs.map((log, i) => (
              <div
                key={i}
                className="rounded-md bs-muted p-3 theme-tertiary-bg"
              >
                {log.decoded ? (
                  <div>
                    <span
                      className="text-sm font-medium theme-warning"
                    >
                      {log.decoded.eventName}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {log.decoded.params.map((p, j) => (
                        <div key={j} className="text-xs flex gap-inline">
                          <span className="theme-text-secondary">
                            {p.name}:
                          </span>
                          <span
                            className="break-all theme-mono theme-text"
                          >
                            {p.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <DataRow label="Address" value={log.address} mono />
                    <DataRow label="Data" value={log.data} mono />
                    {log.topics.map((t, j) => (
                      <DataRow key={j} label={`Topic ${j}`} value={t} mono />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
