import { useState } from "react";
import { Icon } from "@iconify/react";
import { useNavigate } from "react-router-dom";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import { useActiveChainId } from "../../lib/activeChain";
import type { WorkspaceItemKind } from "../../lib/workspace/types";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Drop-in button (used inside detail-page headers, next to EntityActionBar)
 * that lets the user file the current entity into a workspace. Opens a small
 * picker with existing workspaces + an inline "Create new and add" option.
 *
 * Kept as its own component (not folded into EntityActionBar) because
 * EntityActionBar's Action type is href-only by design — every other action
 * navigates. Workspaces need a popover, not a navigation, so the asymmetry
 * is real; better to make it visible.
 */
export function AddToWorkspaceButton({
  kind,
  value,
  chainId,
  compact = false,
}: {
  kind: WorkspaceItemKind;
  value: string;
  /** Chain to pin the item to; defaults to the route's active chain. */
  chainId?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { workspaces, create, addToWorkspace } = useWorkspaces();
  const navigate = useNavigate();
  const activeChainId = useActiveChainId();
  const pinnedChainId = chainId ?? activeChainId;
  const [newName, setNewName] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const handlePick = async (id: string) => {
    await addToWorkspace.mutateAsync({ id, kind, value, chainId: pinnedChainId });
    setJustAdded(id);
    setTimeout(() => setOpen(false), 800);
  };

  const handleCreateAndAdd = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const ws = await create.mutateAsync({ name: newName.trim() });
    await addToWorkspace.mutateAsync({ id: ws.id, kind, value, chainId: pinnedChainId });
    setOpen(false);
    setNewName("");
    navigate(`/workspace/${ws.id}`);
  };

  const trigger = compact ? (
    <Tooltip label="Add to Workspace">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add to Workspace"
        className="flex items-center justify-center w-7 h-7 transition-colors theme-text-muted"
        style={{ backgroundColor: "transparent", boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
      >
        <Icon icon="heroicons:folder-plus" className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  ) : (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="inline-flex items-center gap-tight text-xs px-3 py-1.5 theme-tertiary-bg theme-text-secondary"
      style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
    >
      <Icon icon="heroicons:folder-plus" className="w-3.5 h-3.5" />
      Add to Workspace
    </button>
  );

  return (
    <div className="relative inline-block">
      {trigger}
      {open && (
        <div
          className="absolute right-0 z-50 w-72 mt-1 card p-2 space-y-1"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
        >
          <div className="text-[10px] uppercase tracking-widest px-2 pt-1 pb-2 theme-text-muted">
            Add this {kind} to…
          </div>

          {workspaces.length === 0 && (
            <div className="px-2 pb-2 text-xs theme-text-muted">
              No workspaces yet. Create one below to start filing.
            </div>
          )}

          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => void handlePick(w.id)}
              className={`w-full text-left flex items-center justify-between gap-row px-2 py-1.5 text-xs theme-text ${justAdded === w.id ? "theme-accent-bg" : ""}`}
              style={{ backgroundColor: justAdded === w.id ? "var(--color-accent-muted)" : "transparent" }}
            >
              <span className="flex items-center gap-tight min-w-0">
                <Icon icon="heroicons:folder" className="w-3.5 h-3.5 theme-accent shrink-0" />
                <span className="truncate">{w.name}</span>
              </span>
              {justAdded === w.id ? (
                <Icon icon="heroicons:check" className="w-3.5 h-3.5 theme-success shrink-0" />
              ) : (
                <span className="text-[10px] font-mono theme-text-muted shrink-0">{w.items.length}</span>
              )}
            </button>
          ))}

          <form onSubmit={handleCreateAndAdd} className="px-1 pt-1 border-t" style={{ borderColor: "var(--color-border-muted)" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Create new workspace and add…"
              className="w-full text-xs px-2 py-1.5 theme-primary-bg theme-text"
              style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
            />
            {newName.trim() && (
              <button
                type="submit"
                className="mt-1 w-full text-xs px-2 py-1.5"
                style={{ backgroundColor: "var(--color-accent)", color: "#fff" }}
              >
                Create &quot;{newName.trim()}&quot; and add
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
