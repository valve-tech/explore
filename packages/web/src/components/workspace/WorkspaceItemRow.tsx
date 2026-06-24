import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import type { WorkspaceItem } from "../../lib/workspace/types";
import { chainById } from "../../lib/chains";
import { Tooltip } from "../primitives/Tooltip";
import { AddressPreview } from "./previews/AddressPreview";
import { TxPreview } from "./previews/TxPreview";
import { BlockPreview } from "./previews/BlockPreview";

/**
 * One row in a Workspace's item list. Two states:
 *   - collapsed: type icon + short value + optional user label + canonical link
 *   - expanded:  an inline preview card that fetches a few live facts for the
 *                item from its PINNED chain (see previews/ — Address/Tx/Block)
 *
 * Per-row expansion (not bulk) keeps API load proportional to user attention —
 * a 50-item workspace doesn't fan out 50 simultaneous fetches just to render
 * (the preview only mounts, and only then fetches, once a row is expanded).
 */
export function WorkspaceItemRow({
  item,
  canonicalHref,
  onRemove,
}: {
  item: WorkspaceItem;
  canonicalHref: string;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card p-3">
      <div className="flex items-center gap-row">
        <Icon icon={iconFor(item.kind)} className={`w-4 h-4 shrink-0 ${colorFor(item.kind)}`} />
        <div className="min-w-0 flex-1">
          <Link to={canonicalHref} className="block theme-text" style={{ textDecoration: "none" }}>
            <div className="flex items-center gap-inline">
              <span className="text-[10px] uppercase tracking-widest theme-text-muted">
                {item.kind}
              </span>
              {item.label && (
                <span className="text-xs font-medium theme-text">{item.label}</span>
              )}
            </div>
            <div className="font-mono text-xs truncate theme-accent">{item.value}</div>
          </Link>
          <div className="text-[11px] mt-0.5 theme-text-muted">
            added {ago(item.addedAt)}
            <span> · {chainById(item.chainId)?.name ?? `chain ${item.chainId}`}</span>
          </div>
        </div>
        <div className="flex gap-tight shrink-0">
          <Tooltip label={expanded ? "Collapse" : "Expand"}>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-xs px-1.5 py-1 theme-text-muted"
            >
              <Icon icon={expanded ? "heroicons:chevron-up" : "heroicons:chevron-down"} className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label="Remove from workspace">
            <button onClick={onRemove} className="text-xs px-1.5 py-1 theme-text-muted">
              <Icon icon="heroicons:x-mark" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 text-xs theme-text-secondary" style={{ borderTop: "1px solid var(--color-border-muted)" }}>
          {/* The preview only mounts when the row is expanded — collapsed
              rows never trigger a fetch, so a workspace with N items costs
              0 API calls until the user opens one. Previews fetch from the
              item's PINNED chain, not the route's active chain. */}
          {item.kind === "address" && (
            <AddressPreview address={item.value} chainId={item.chainId} />
          )}
          {item.kind === "tx" && (
            <TxPreview hash={item.value} chainId={item.chainId} />
          )}
          {item.kind === "block" && (
            <BlockPreview numberOrHash={item.value} chainId={item.chainId} />
          )}
        </div>
      )}
    </div>
  );
}

function iconFor(kind: WorkspaceItem["kind"]): string {
  switch (kind) {
    case "address":
      return "heroicons:identification";
    case "tx":
      return "heroicons:arrow-right-circle";
    case "block":
      return "heroicons:cube";
  }
}

function colorFor(kind: WorkspaceItem["kind"]): string {
  switch (kind) {
    case "address":
      return "theme-accent";
    case "tx":
      return "theme-success";
    case "block":
      return "theme-warning";
  }
}

function ago(ms: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
