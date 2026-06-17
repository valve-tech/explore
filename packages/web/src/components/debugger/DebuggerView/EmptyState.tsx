import { Icon } from "@iconify/react";
import { useNavigate } from "react-router-dom";
import { Tooltip } from "../../primitives/Tooltip";
import { useRecentDebuggerTxs } from "../../../hooks/useRecentDebuggerTxs";
import {
  removeDebuggerTx,
  clearDebuggerTxs,
} from "../../../lib/recentDebuggerTxs";

function short(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function ago(ms: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Pre-search placeholder. Shown when no tx hash has been submitted yet.
 *  Surfaces recently-debugged transactions for one-click reopen. */
export function EmptyState() {
  const navigate = useNavigate();
  const recent = useRecentDebuggerTxs();

  return (
    <div className="space-y-stack">
      <div className="rounded-lg bs p-12 flex flex-col items-center justify-center text-center theme-card-bg">
        <Icon
          icon="heroicons:bug-ant"
          className="w-16 h-16 mb-4"
          style={{ color: "var(--color-border-default)" }}
        />
        <p className="text-sm mb-1 theme-text-secondary">Enter a transaction hash to debug</p>
        <p className="text-xs theme-text-muted">Inspect call trees, gas usage, and opcode execution</p>
      </div>

      {recent.length > 0 && (
        <div className="card overflow-hidden">
          <div className="bs-b-muted flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-inline">
              <Icon icon="heroicons:clock" className="w-4 h-4 theme-accent" />
              <h3 className="text-xs font-semibold uppercase tracking-widest theme-text-secondary">
                Recently debugged
              </h3>
            </div>
            <button
              onClick={clearDebuggerTxs}
              className="text-[11px] transition-opacity hover:opacity-100 theme-text-muted bg-transparent"
            >
              Clear
            </button>
          </div>
          <ul>
            {recent.map((t) => (
              <li
                key={t.hash}
                className="bs-b-muted group flex items-center justify-between gap-row px-4 py-2.5 cursor-pointer hover:opacity-90"
                onClick={() => navigate(`/debugger/${t.hash}`)}
              >
                <Tooltip label={t.hash} className="min-w-0">
                  <span className="font-mono text-xs truncate theme-accent">
                    {short(t.hash)}
                  </span>
                </Tooltip>
                <div className="flex items-center gap-row shrink-0">
                  <span className="text-[11px] theme-text-muted">{ago(t.lastSeen)}</span>
                  <Tooltip label="Remove">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeDebuggerTx(t.hash);
                      }}
                      aria-label="Remove"
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 theme-text-muted bg-transparent"
                    >
                      <Icon icon="heroicons:x-mark" className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
