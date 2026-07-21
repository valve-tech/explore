import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useWatchRules } from "../../../hooks/useWatchRules";
import { useWatchLog } from "../../../hooks/useWatchLog";
import { scanPath } from "../../../lib/scanRoutes";
import { chainById } from "../../../lib/chains";
import { ruleLabel, type WatchRule } from "../../../lib/watcher/types";
import { renderWatchSummary } from "../../../lib/watcher/summary";
import type { Workspace } from "../../../lib/workspace/types";
import { Tooltip } from "../../primitives/Tooltip";
import { WatchRuleForm } from "./WatchRuleForm";

/**
 * Per-workspace watcher UI: the rules scoped to this workspace, an add form,
 * and the recent on-chain activity those rules have surfaced. Everything is
 * client-side and tab-open only — the copy says so, because a user who closes
 * the tab should not expect to have missed-and-stored events waiting (that's
 * the server-side monitor's job, deliberately not this).
 */
export function WatchRulesPanel({ workspace }: { workspace: Workspace }) {
  const { rules, toggle, remove, add, setWorkspaceEnabled } = useWatchRules();
  const { matches } = useWatchLog();
  const [showForm, setShowForm] = useState(false);

  const myRules = useMemo(
    () => rules.filter((r) => r.workspaceId === workspace.id),
    [rules, workspace.id],
  );
  const myMatches = useMemo(
    () => matches.filter((m) => m.workspaceId === workspace.id).slice(0, 20),
    [matches, workspace.id],
  );
  // Pause-all when any rule is live; resume-all when they're all paused.
  const anyEnabled = myRules.some((r) => r.enabled);

  return (
    <div className="card p-2 sm:p-4 mb-4">
      <div className="flex items-center justify-between gap-row mb-3">
        <div className="flex items-center gap-inline min-w-0">
          <Icon icon="heroicons:signal" className="w-4 h-4 theme-accent" />
          <h2 className="text-sm font-semibold theme-text">Watches</h2>
          <span className="text-[11px] theme-text-muted">
            {myRules.length === 0
              ? "client-side · tab-open"
              : `${myRules.filter((r) => r.enabled).length} active · client-side`}
          </span>
        </div>
        <div className="flex items-center gap-tight shrink-0">
          {myRules.length > 1 && (
            <Tooltip
              label={anyEnabled ? "Pause every watch here" : "Resume every watch here"}
            >
              <button
                onClick={() =>
                  setWorkspaceEnabled.mutate({
                    workspaceId: workspace.id,
                    enabled: !anyEnabled,
                  })
                }
                className="text-xs px-2 py-1 flex items-center gap-tight theme-text-muted"
              >
                <Icon
                  icon={anyEnabled ? "heroicons:pause" : "heroicons:play"}
                  className="w-4 h-4"
                />
                {anyEnabled ? "Pause all" : "Resume all"}
              </button>
            </Tooltip>
          )}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-xs px-2 py-1 flex items-center gap-tight"
            style={{ color: showForm ? "var(--color-accent)" : "var(--color-text-muted)" }}
          >
            <Icon
              icon={showForm ? "heroicons:x-mark" : "heroicons:plus"}
              className="w-4 h-4"
            />
            {!showForm && "Add"}
          </button>
        </div>
      </div>

      {showForm && (
        <WatchRuleForm
          workspace={workspace}
          onAdd={(input) => add.mutateAsync(input)}
          onCancel={() => setShowForm(false)}
        />
      )}

      {myRules.length === 0 && !showForm ? (
        <p className="text-xs theme-text-muted leading-relaxed">
          Watch an address or token for live on-chain activity. Notifications
          fire in this tab while it&apos;s open and run on your configured RPC —
          nothing is sent to a server.
        </p>
      ) : (
        <ul className="space-y-stack">
          {myRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={() => toggle.mutate(rule.id)}
              onRemove={() => remove.mutate(rule.id)}
            />
          ))}
        </ul>
      )}

      {myMatches.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide theme-text-muted mb-2">
            Recent activity
          </div>
          <ul className="space-y-tight">
            {myMatches.map((m) => (
              <li key={m.id} className="text-xs flex items-start gap-inline">
                <span className="theme-text-muted shrink-0 font-mono text-[11px] mt-0.5">
                  {timeAgo(m.at)}
                </span>
                {m.txHash ? (
                  <Link
                    to={scanPath("tx", m.txHash)}
                    className="theme-text hover:underline min-w-0"
                  >
                    {renderWatchSummary(m)}
                  </Link>
                ) : (
                  <span className="theme-text min-w-0">
                    {renderWatchSummary(m)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onToggle,
  onRemove,
}: {
  rule: WatchRule;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const chain = chainById(rule.chainId);
  return (
    <li className="flex items-center justify-between gap-row text-xs">
      <div className="flex items-center gap-inline min-w-0">
        <Icon
          icon={
            rule.kind === "erc20_transfer"
              ? "heroicons:arrow-path-rounded-square"
              : "heroicons:user-circle"
          }
          className="w-4 h-4 shrink-0 theme-text-muted"
        />
        <span className="theme-text truncate">{ruleLabel(rule)}</span>
        <span className="theme-text-muted font-mono text-[11px] truncate">
          {rule.kind === "erc20_transfer" ? rule.contractAddress : rule.address}
        </span>
        {chain && (
          <span className="text-[10px] px-1.5 py-0.5 shrink-0 theme-text-muted" style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}>
            {chain.symbol}
          </span>
        )}
      </div>
      <div className="flex items-center gap-tight shrink-0">
        <Tooltip label={rule.enabled ? "Pause" : "Resume"}>
          <button
            onClick={onToggle}
            className="px-2 py-1"
            style={{ color: rule.enabled ? "var(--color-accent)" : "var(--color-text-muted)" }}
          >
            <Icon
              icon={rule.enabled ? "heroicons:pause" : "heroicons:play"}
              className="w-4 h-4"
            />
          </button>
        </Tooltip>
        <Tooltip label="Remove">
          <button onClick={onRemove} className="px-2 py-1 theme-text-muted">
            <Icon icon="heroicons:trash" className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </li>
  );
}

/** Compact relative time — "now", "3m", "2h", "5d". */
function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
