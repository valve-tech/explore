import { useState, useEffect, useCallback } from "react";
import { getActionLogs, type ActionLog } from "../../api/actions";

interface ActionLogsProps {
  actionId: number;
  actionName: string;
  onBack: () => void;
}

export default function ActionLogs({ actionId, actionName, onBack }: ActionLogsProps) {
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const limit = 15;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getActionLogs(actionId, page, limit);
      setLogs(result.rows);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [actionId, page]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.ceil(total / limit);

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + "Z");
    return d.toLocaleString();
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-row mb-4">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-sm rounded-md bs transition-colors theme-text-secondary"
          style={{ backgroundColor: "transparent" }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          Back
        </button>
        <h2 className="text-lg font-semibold theme-text">
          Logs: {actionName}
        </h2>
        <span className="text-sm theme-text-secondary">
          ({total} total)
        </span>
        <button
          onClick={() => void fetchLogs()}
          className="ml-auto px-3 py-1.5 text-sm rounded-md bs transition-colors theme-text-secondary"
          style={{ backgroundColor: "transparent" }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-lg bs overflow-hidden theme-card-bg"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="theme-tertiary-bg bs-b"
              >
                <th
                  className="text-left px-4 py-2.5 font-medium theme-text-secondary"
                >
                  Timestamp
                </th>
                <th
                  className="text-left px-4 py-2.5 font-medium theme-text-secondary"
                >
                  Trigger
                </th>
                <th
                  className="text-right px-4 py-2.5 font-medium theme-text-secondary"
                >
                  Duration
                </th>
                <th
                  className="text-center px-4 py-2.5 font-medium theme-text-secondary"
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-center py-8 theme-text-secondary"
                  >
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-center py-8 theme-text-secondary"
                  >
                    No execution logs yet
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedRow === log.id;
                  let triggerType = "unknown";
                  try {
                    const td = JSON.parse(log.trigger_data) as { type?: string };
                    triggerType = td.type ?? "unknown";
                  } catch {
                    // ignore
                  }

                  return (
                    <tr key={log.id} style={{ cursor: "pointer" }}>
                      <td colSpan={4} className="p-0">
                        {/* Main row */}
                        <div
                          className="flex items-center px-4 py-2.5 transition-colors"
                          onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                          style={{
                            borderBottom: isExpanded
                              ? "none"
                              : "1px solid var(--color-border-muted)",
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                          }}
                        >
                          <span
                            className="flex-1 theme-text"
                          >
                            {formatDate(log.triggered_at)}
                          </span>
                          <span
                            className="flex-1 px-4 theme-text-secondary"
                          >
                            {triggerType}
                          </span>
                          <span
                            className="flex-1 text-right px-4 theme-text-secondary theme-mono"
                          >
                            {log.duration_ms}ms
                          </span>
                          <span className="flex-none w-20 text-center">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: log.success
                                  ? "var(--color-success-muted)"
                                  : "var(--color-danger-muted)",
                                color: log.success
                                  ? "var(--color-success)"
                                  : "var(--color-danger)",
                              }}
                            >
                              {log.success ? "Success" : "Error"}
                            </span>
                          </span>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div
                            className="px-4 pb-3 space-y-2 bs-b-muted"
                          >
                            {log.stdout && (
                              <div>
                                <div
                                  className="text-xs font-medium mb-1 theme-text-secondary"
                                >
                                  stdout
                                </div>
                                <pre
                                  className="text-xs p-2 rounded overflow-x-auto theme-primary-bg theme-success theme-mono bs-muted"
                                >
                                  {log.stdout}
                                </pre>
                              </div>
                            )}
                            {log.stderr && (
                              <div>
                                <div
                                  className="text-xs font-medium mb-1 theme-text-secondary"
                                >
                                  stderr
                                </div>
                                <pre
                                  className="text-xs p-2 rounded overflow-x-auto theme-primary-bg theme-danger theme-mono bs-muted"
                                >
                                  {log.stderr}
                                </pre>
                              </div>
                            )}
                            {log.trigger_data && log.trigger_data !== "{}" && (
                              <div>
                                <div
                                  className="text-xs font-medium mb-1 theme-text-secondary"
                                >
                                  Trigger Data
                                </div>
                                <pre
                                  className="text-xs p-2 rounded overflow-x-auto theme-primary-bg theme-text-secondary theme-mono bs-muted"
                                >
                                  {JSON.stringify(JSON.parse(log.trigger_data), null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm theme-text-secondary">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-inline">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-md bs transition-colors disabled:opacity-40 theme-text-secondary"
              style={{ backgroundColor: "transparent" }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-md bs transition-colors disabled:opacity-40 theme-text-secondary"
              style={{ backgroundColor: "transparent" }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
