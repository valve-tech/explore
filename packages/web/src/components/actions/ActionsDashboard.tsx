import { useState, useEffect, useCallback } from "react";
import {
  listActions,
  updateAction,
  deleteAction,
  getAction,
  type Action,
  type ActionStats,
} from "../../api/actions";
import ActionEditor from "./ActionEditor";
import ActionLogs from "./ActionLogs";
import { useActiveChainId } from "../../lib/activeChain";
import { Tooltip } from "../primitives/Tooltip";

// ---------------------------------------------------------------------------
// Trigger type badge colors
// ---------------------------------------------------------------------------
const TRIGGER_COLORS: Record<string, { bg: string; fg: string }> = {
  block: { bg: "var(--color-accent-muted)", fg: "var(--color-accent)" },
  event: { bg: "var(--color-warning-muted)", fg: "var(--color-warning)" },
  periodic: { bg: "var(--color-success-muted)", fg: "var(--color-success)" },
  webhook: { bg: "rgba(56, 189, 248, 0.15)", fg: "#38bdf8" },
};

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------
type View =
  | { type: "list" }
  | { type: "create" }
  | { type: "edit"; action: Action }
  | { type: "logs"; actionId: number; actionName: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ActionsDashboard() {
  const chainId = useActiveChainId();
  const [view, setView] = useState<View>({ type: "list" });
  const [actions, setActions] = useState<Action[]>([]);
  const [stats, setStats] = useState<ActionStats>({ total: 0, active: 0, todayExecutions: 0 });
  const [loading, setLoading] = useState(true);

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listActions(chainId);
      setActions(result.actions);
      setStats(result.stats);
    } catch (err) {
      console.error("Failed to fetch actions:", err);
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    void fetchActions();
  }, [fetchActions]);

  // Toggle enabled
  const handleToggleEnabled = async (action: Action) => {
    try {
      await updateAction(action.id, { enabled: !action.enabled });
      await fetchActions();
    } catch (err) {
      console.error("Failed to toggle action:", err);
    }
  };

  // Delete
  const handleDelete = async (action: Action) => {
    if (!confirm(`Delete action "${action.name}"?`)) return;
    try {
      await deleteAction(action.id);
      await fetchActions();
    } catch (err) {
      console.error("Failed to delete action:", err);
    }
  };

  // Edit click: fetch latest
  const handleEdit = async (action: Action) => {
    try {
      const latest = await getAction(action.id);
      setView({ type: "edit", action: latest });
    } catch (err) {
      console.error("Failed to fetch action:", err);
    }
  };

  // After save
  const handleSaved = () => {
    setView({ type: "list" });
    void fetchActions();
  };

  // ---------------------------------------------------------------------------
  // Render sub-views
  // ---------------------------------------------------------------------------
  if (view.type === "create") {
    return (
      <ActionEditor
        onSaved={handleSaved}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "edit") {
    return (
      <ActionEditor
        action={view.action}
        onSaved={handleSaved}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "logs") {
    return (
      <ActionLogs
        actionId={view.actionId}
        actionName={view.actionName}
        onBack={() => setView({ type: "list" })}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // List view
  // ---------------------------------------------------------------------------
  return (
    <div>
      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Actions" value={stats.total} />
        <StatCard label="Active" value={stats.active} color="var(--color-success)" />
        <StatCard label="Executions Today" value={stats.todayExecutions} color="var(--color-accent)" />
      </div>

      {/* Header */}
      <div className="card p-4 flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold theme-text">
          Actions
        </h2>
        <button
          onClick={() => setView({ type: "create" })}
          className="px-4 py-2 rounded-md text-sm font-medium transition-colors theme-accent-solid text-white"
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent-hover)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "";
          }}
        >
          + Create Action
        </button>
      </div>

      {/* Loading */}
      {loading ? (
        <div
          className="text-center py-12 text-sm theme-text-secondary"
        >
          Loading actions...
        </div>
      ) : actions.length === 0 ? (
        <EmptyState onCreate={() => setView({ type: "create" })} />
      ) : (
        <div className="grid gap-row">
          {actions.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              onEdit={() => void handleEdit(action)}
              onToggle={() => void handleToggleEnabled(action)}
              onDelete={() => void handleDelete(action)}
              onViewLogs={() =>
                setView({
                  type: "logs",
                  actionId: action.id,
                  actionName: action.name,
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div
      className="rounded-lg bs p-4 theme-card-bg"
    >
      <div
        className="text-xs font-medium mb-1 theme-text-secondary"
      >
        {label}
      </div>
      <div
        className="text-2xl font-bold theme-mono"
        style={{
          color: color ?? "var(--color-text-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="rounded-lg bs p-12 text-center theme-card-bg"
    >
      <div
        className="text-4xl mb-4 theme-text-muted"
      >
        {"{ }"}
      </div>
      <h3
        className="text-lg font-medium mb-2 theme-text"
      >
        No actions yet
      </h3>
      <p
        className="text-sm mb-4 theme-text-secondary"
      >
        Create serverless functions that react to on-chain events, run on a schedule, or respond to webhooks.
      </p>
      <button
        onClick={onCreate}
        className="px-4 py-2 rounded-md text-sm font-medium transition-colors theme-accent-solid text-white"
        onMouseOver={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-accent-hover)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.backgroundColor = "";
        }}
      >
        + Create Your First Action
      </button>
    </div>
  );
}

function ActionCard({
  action,
  onEdit,
  onToggle,
  onDelete,
  onViewLogs,
}: {
  action: Action;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onViewLogs: () => void;
}) {
  const triggerColor = TRIGGER_COLORS[action.triggerType] ?? {
    bg: "var(--color-bg-tertiary)",
    fg: "var(--color-text-secondary)",
  };

  const updatedDate = new Date(action.updatedAt + "Z").toLocaleString();

  return (
    <div
      className="rounded-lg bs p-4 transition-colors theme-card-bg"
      style={{
        opacity: action.enabled ? 1 : 0.6,
      }}
    >
      <div className="flex items-start justify-between">
        {/* Left: name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-inline mb-1">
            <h3
              className="text-sm font-medium truncate theme-text"
            >
              {action.name}
            </h3>
            <span
              className="inline-block px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 capitalize"
              style={{
                backgroundColor: triggerColor.bg,
                color: triggerColor.fg,
              }}
            >
              {action.triggerType}
            </span>
            {!action.enabled && (
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 theme-tertiary-bg theme-text-muted"
              >
                Disabled
              </span>
            )}
          </div>
          <div
            className="text-xs theme-text-muted"
          >
            Updated {updatedDate}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-inline ml-4 flex-shrink-0">
          {/* Enabled toggle */}
          <Tooltip label={action.enabled ? "Disable" : "Enable"}>
            <button
              onClick={onToggle}
              className="relative w-10 h-5 rounded-full transition-colors"
              style={{
                backgroundColor: action.enabled
                  ? "var(--color-success)"
                  : "var(--color-border-default)",
              }}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white"
                style={{
                  left: action.enabled ? "calc(100% - 1.125rem)" : "0.125rem",
                }}
              />
            </button>
          </Tooltip>

          <button
            onClick={onViewLogs}
            className="px-2.5 py-1 text-xs rounded bs transition-colors theme-text-secondary"
            style={{
              backgroundColor: "transparent",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Logs
          </button>

          <button
            onClick={onEdit}
            className="px-2.5 py-1 text-xs rounded bs transition-colors theme-text-secondary"
            style={{
              backgroundColor: "transparent",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Edit
          </button>

          <button
            onClick={onDelete}
            className="px-2.5 py-1 text-xs rounded bs transition-colors theme-danger"
            style={{
              backgroundColor: "transparent",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "var(--color-danger-muted)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
