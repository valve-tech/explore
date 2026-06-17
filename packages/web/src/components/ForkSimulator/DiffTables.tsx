import type { ForkSimulationResult } from "../../api/simulate";
import { DiffSection } from "./primitives";
import { Tooltip } from "../primitives/Tooltip";

export function BalanceChangesTable({
  changes,
}: {
  changes: ForkSimulationResult["stateDiff"]["balanceChanges"];
}) {
  return (
    <DiffSection title="Balance Changes" count={changes.length}>
      <table
        className="w-full text-xs theme-mono"
      >
        <thead>
          <tr className="theme-text-muted">
            <th className="text-left py-1 px-2">Address</th>
            <th className="text-right py-1 px-2">Before (PLS)</th>
            <th className="text-right py-1 px-2">After (PLS)</th>
            <th className="text-right py-1 px-2">Delta</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((bc, i) => (
            <tr
              key={i}
              className="bs-t"
            >
              <td className="py-1.5 px-2 theme-text">
                <Tooltip label={bc.address}>
                  {bc.address.slice(0, 8)}...{bc.address.slice(-6)}
                </Tooltip>
              </td>
              <td
                className="text-right py-1.5 px-2 theme-text-muted"
              >
                {parseFloat(bc.before).toFixed(4)}
              </td>
              <td
                className="text-right py-1.5 px-2 theme-text"
              >
                {parseFloat(bc.after).toFixed(4)}
              </td>
              <td
                className={`text-right py-1.5 px-2 font-semibold ${
                  bc.delta.startsWith("+") || !bc.delta.startsWith("-")
                    ? "theme-success"
                    : "theme-danger"
                }`}
              >
                {bc.delta.startsWith("-") || bc.delta.startsWith("+")
                  ? bc.delta
                  : `+${bc.delta}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DiffSection>
  );
}

export function StorageChangesTable({
  changes,
}: {
  changes: ForkSimulationResult["stateDiff"]["storageChanges"];
}) {
  return (
    <DiffSection title="Storage Changes" count={changes.length}>
      <table
        className="w-full text-xs theme-mono"
      >
        <thead>
          <tr className="theme-text-muted">
            <th className="text-left py-1 px-2">Contract</th>
            <th className="text-left py-1 px-2">Slot</th>
            <th className="text-left py-1 px-2">Before</th>
            <th className="text-left py-1 px-2">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((sc, i) => (
            <tr
              key={i}
              className="bs-t"
            >
              <td className="py-1.5 px-2 theme-text">
                <Tooltip label={sc.address}>
                  {sc.contractName ??
                    `${sc.address.slice(0, 8)}...${sc.address.slice(-4)}`}
                </Tooltip>
              </td>
              <td className="py-1.5 px-2 theme-text-muted">
                <Tooltip label={sc.slot}>
                  {sc.decodedName ?? `${sc.slot.slice(0, 10)}...`}
                </Tooltip>
              </td>
              <td className="py-1.5 px-2 theme-danger">
                <Tooltip label={sc.before}>{sc.before.slice(0, 14)}...</Tooltip>
              </td>
              <td className="py-1.5 px-2 theme-success">
                <Tooltip label={sc.after}>{sc.after.slice(0, 14)}...</Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DiffSection>
  );
}

export function EventsList({
  logs,
}: {
  logs: ForkSimulationResult["logs"];
}) {
  return (
    <DiffSection title="Events Emitted" count={logs.length}>
      <div className="space-y-2 p-2">
        {logs.map((log, i) => (
          <div
            key={i}
            className="text-xs theme-mono"
          >
            <span className="theme-accent">
              {log.address.slice(0, 10)}...
            </span>
            {log.topics[0] && (
              <span className="theme-text-muted">
                {" "}
                topic0: {log.topics[0].slice(0, 14)}...
              </span>
            )}
          </div>
        ))}
      </div>
    </DiffSection>
  );
}
