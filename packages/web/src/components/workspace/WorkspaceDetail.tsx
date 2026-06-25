import { useState, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import { useActiveChainId } from "../../lib/activeChain";
import { DEFAULT_CHAIN_ID } from "../../lib/chains";
import type { Workspace, WorkspaceItem } from "../../lib/workspace/types";
import { scanPath } from "../../lib/scanRoutes";
import { Tooltip } from "../primitives/Tooltip";
import { WorkspaceItemRow } from "./WorkspaceItemRow";
import { BulkPastePanel } from "./BulkPastePanel";
import { PortfolioPanel } from "./PortfolioPanel";
import { WatchRulesPanel } from "./watcher/WatchRulesPanel";

/**
 * One Workspace's items, listed with type icon + value + optional label. Each
 * row click navigates to the item's canonical Explore route (/address/0x…,
 * /tx/0x…, /block/N); the chevron expands an inline mini-card with live data
 * fetched on demand (per row, so an empty workspace doesn't fan out N requests
 * for nothing).
 */
export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeChainId = useActiveChainId();
  const { workspaces, isLoading, addToWorkspace, removeFromWorkspace, rename, remove } = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === id) ?? null,
    [workspaces, id],
  );
  const [bulkOpen, setBulkOpen] = useState(false);

  if (isLoading) {
    return <div className="text-sm theme-text-muted">Loading…</div>;
  }
  if (!workspace) {
    return <NotFound />;
  }

  return (
    <div className="max-w-5xl">
      <Link to="/workspace" className="text-xs flex items-center gap-1.5 mb-4 theme-text-muted">
        <Icon icon="heroicons:chevron-left" className="w-3 h-3" />
        All workspaces
      </Link>

      <Header
        workspace={workspace}
        onBulkPaste={() => setBulkOpen((v) => !v)}
        bulkOpen={bulkOpen}
        onRename={(name, description) =>
          rename.mutateAsync({ id: workspace.id, name, description })
        }
        onDelete={async () => {
          await remove.mutateAsync(workspace.id);
          navigate("/workspace", { replace: true });
        }}
      />

      {bulkOpen && (
        <BulkPastePanel
          workspace={workspace}
          onClose={() => setBulkOpen(false)}
          onAdd={async (items) => {
            // Add sequentially so the IDB write is one consistent
            // transform-then-persist per item (matches the existing
            // addToWorkspace mutation contract). Each call is fast — the
            // store helpers are pure and the write is a single idb-keyval
            // setItem on a small blob — so even 100 items completes in well
            // under a second.
            // Bulk-pasted items pin to the route's active chain — the
            // paste has no chain information of its own.
            for (const it of items) {
              await addToWorkspace.mutateAsync({
                id: workspace.id,
                kind: it.kind,
                value: it.value,
                chainId: activeChainId,
              });
            }
          }}
        />
      )}

      <PortfolioPanel workspace={workspace} chainId={activeChainId} />

      <WatchRulesPanel workspace={workspace} />

      <Items
        workspace={workspace}
        onRemove={(itemId) => removeFromWorkspace.mutate({ id: workspace.id, itemId })}
      />
    </div>
  );
}

function Header({
  workspace,
  bulkOpen,
  onBulkPaste,
  onRename,
  onDelete,
}: {
  workspace: Workspace;
  bulkOpen: boolean;
  onBulkPaste: () => void;
  onRename: (name: string, description?: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await onRename(name.trim(), description.trim() || undefined);
          setEditing(false);
        }}
        className="card p-4 mb-4 space-y-stack"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full text-base font-semibold px-2 py-1.5 theme-primary-bg theme-text"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full text-xs px-2 py-1.5 theme-primary-bg theme-text-secondary"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        />
        <div className="flex gap-inline">
          <button
            type="submit"
            disabled={!name.trim()}
            className="text-xs px-3 py-1.5"
            style={{ backgroundColor: "var(--color-accent)", color: "#fff", opacity: !name.trim() ? 0.5 : 1 }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setName(workspace.name);
              setDescription(workspace.description ?? "");
              setEditing(false);
            }}
            className="text-xs px-3 py-1.5 theme-text-secondary"
            style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="card p-4 mb-4 flex items-start justify-between gap-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-inline mb-1">
          <Icon icon="heroicons:folder" className="w-4 h-4 theme-accent" />
          <h1 className="text-lg font-semibold theme-text">{workspace.name}</h1>
        </div>
        {workspace.description && (
          <p className="text-xs theme-text-secondary">{workspace.description}</p>
        )}
        <div className="text-[11px] mt-1 theme-text-muted">
          {workspace.items.length} {workspace.items.length === 1 ? "item" : "items"}
        </div>
      </div>
      <div className="flex gap-tight shrink-0">
        <Tooltip label="Bulk paste">
          <button
            onClick={onBulkPaste}
            className="text-xs px-2 py-1 flex items-center gap-tight"
            style={{
              color: bulkOpen ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            <Icon icon="heroicons:clipboard-document-list" className="w-4 h-4" />
          </button>
        </Tooltip>
        <button onClick={() => setEditing(true)} className="text-xs px-2 py-1 theme-text-muted">
          <Icon icon="heroicons:pencil" className="w-4 h-4" />
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={() => void onDelete()}
              className="text-[11px] px-2 py-1 theme-danger-bg theme-danger"
            >
              Confirm delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-[11px] px-2 py-1 theme-text-muted">
              Keep
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs px-2 py-1 theme-text-muted">
            <Icon icon="heroicons:trash" className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function Items({
  workspace,
  onRemove,
}: {
  workspace: Workspace;
  onRemove: (itemId: string) => void;
}) {
  if (workspace.items.length === 0) {
    return (
      <div className="card p-8 text-center theme-text-muted">
        <Icon icon="heroicons:plus-circle" className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <div className="text-sm max-w-md mx-auto leading-relaxed">
          Open any address, transaction, or block and click <span className="theme-text-secondary">&quot;Add to Workspace&quot;</span> in its action bar to drop it in here.
        </div>
      </div>
    );
  }
  return (
    <ul className="space-y-stack">
      {workspace.items.map((it) => (
        <li key={it.id}>
          <WorkspaceItemRow item={it} canonicalHref={canonicalFor(it)} onRemove={() => onRemove(it.id)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Canonical route for an item, scoped to its pinned chain via the
 * `?chainid=N` URL param the entity views read (lib/activeChain.ts). The
 * default chain omits the param so those links stay byte-identical to the
 * single-chain era.
 */
function canonicalFor(item: WorkspaceItem): string {
  const path =
    item.kind === "tx"
      ? scanPath("tx", item.value)
      : item.kind === "block"
        ? scanPath("block", item.value)
        : scanPath("address", item.value);
  if (item.chainId === DEFAULT_CHAIN_ID) return path;
  return `${path}?chainid=${item.chainId}`;
}

function NotFound() {
  return (
    <div className="p-4 max-w-2xl">
      <Link to="/workspace" className="text-xs flex items-center gap-1.5 mb-4 theme-text-muted">
        <Icon icon="heroicons:chevron-left" className="w-3 h-3" />
        All workspaces
      </Link>
      <div className="card p-8 text-center theme-text-muted">
        <Icon icon="heroicons:question-mark-circle" className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <div className="text-sm">This workspace doesn&apos;t exist (or was deleted).</div>
      </div>
    </div>
  );
}
