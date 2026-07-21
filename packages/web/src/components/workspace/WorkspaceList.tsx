import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import type { Workspace } from "../../lib/workspace/types";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Index of named Workspaces. A Workspace is a bucket of heterogeneous items
 * (addresses, txs, blocks) the user wants to track together — investigations,
 * watchlists, research threads. Items inside live at their canonical entity
 * URLs; the Workspace is the meta-view that ties them together.
 */
export default function WorkspaceList() {
  const { workspaces, isLoading, create, remove } = useWorkspaces();
  const [creating, setCreating] = useState(false);

  return (
    <div className="max-w-5xl">
      <Header onNew={() => setCreating(true)} />

      {creating && (
        <CreateRow
          onCancel={() => setCreating(false)}
          onCreate={async (name, description) => {
            await create.mutateAsync({ name, description });
            setCreating(false);
          }}
          submitting={create.isPending}
        />
      )}

      {isLoading ? (
        <Empty hint="Loading…" />
      ) : workspaces.length === 0 ? (
        <Empty hint='No workspaces yet. Create one above, or open an entity (address, tx, block) and use "Add to Workspace" to seed a new one in context.' />
      ) : (
        <ul className="space-y-stack">
          {workspaces.map((w) => (
            <li key={w.id}>
              <WorkspaceRow
                workspace={w}
                onDelete={() => remove.mutate(w.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Header({ onNew }: { onNew: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between flex-wrap gap-row">
      <div>
        <div className="text-xs uppercase tracking-widest mb-1 theme-text-muted">
          Investigate
        </div>
        <h1 className="text-2xl font-semibold theme-text">Workspaces</h1>
        <p className="text-sm mt-1 theme-text-secondary max-w-2xl">
          Named buckets of addresses, transactions, and blocks you&apos;re tracking together.
          Items inside open at their normal Explore routes.
        </p>
      </div>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-tight text-xs px-3 py-1.5"
        style={{ backgroundColor: "var(--color-accent)", color: "#fff" }}
      >
        <Icon icon="heroicons:plus" className="w-3.5 h-3.5" />
        New workspace
      </button>
    </div>
  );
}

function CreateRow({
  onCancel,
  onCreate,
  submitting,
}: {
  onCancel: () => void;
  onCreate: (name: string, description?: string) => void | Promise<void>;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <form
      className="mb-4 card p-2 sm:p-4 space-y-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        void onCreate(n, description.trim() || undefined);
      }}
    >
      <label className="block text-xs theme-text-muted">
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='e.g. "Lido incident 2026-05" or "PulseX swap research"'
          className="mt-1 w-full text-sm px-2 py-1.5 theme-primary-bg theme-text"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        />
      </label>
      <label className="block text-xs theme-text-muted">
        Description <span className="opacity-60">(optional)</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this workspace for?"
          className="mt-1 w-full text-sm px-2 py-1.5 theme-primary-bg theme-text"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        />
      </label>
      <div className="flex gap-inline">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="text-xs px-3 py-1.5"
          style={{ backgroundColor: "var(--color-accent)", color: "#fff", opacity: !name.trim() ? 0.5 : 1 }}
        >
          {submitting ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 theme-text-secondary"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function WorkspaceRow({ workspace, onDelete }: { workspace: Workspace; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="card flex items-center justify-between gap-row p-4">
      <Link to={`/workspace/${workspace.id}`} className="min-w-0 flex-1 block theme-text" style={{ textDecoration: "none" }}>
        <div className="flex items-center gap-inline mb-0.5">
          <Icon icon="heroicons:folder" className="w-4 h-4 theme-accent" />
          <span className="font-semibold text-sm">{workspace.name}</span>
          <span className="text-[11px] font-mono theme-text-muted">
            {workspace.items.length} {workspace.items.length === 1 ? "item" : "items"}
          </span>
        </div>
        {workspace.description && (
          <div className="text-xs theme-text-secondary">{workspace.description}</div>
        )}
        <div className="text-[11px] mt-1 theme-text-muted">
          updated {ago(workspace.updatedAt)}
        </div>
      </Link>
      {confirming ? (
        <div className="flex gap-tight">
          <button
            onClick={onDelete}
            className="text-[11px] px-2 py-1 theme-danger-bg theme-danger"
          >
            Confirm delete
          </button>
          <button onClick={() => setConfirming(false)} className="text-[11px] px-2 py-1 theme-text-muted">
            Keep
          </button>
        </div>
      ) : (
        <Tooltip label="Delete workspace" className="shrink-0">
          <button
            onClick={() => setConfirming(true)}
            className="text-xs theme-text-muted"
          >
            <Icon icon="heroicons:trash" className="w-4 h-4" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="card p-8 text-center theme-text-muted">
      <Icon icon="heroicons:folder-open" className="w-10 h-10 mx-auto mb-3 opacity-50" />
      <div className="text-sm max-w-md mx-auto leading-relaxed">{hint}</div>
    </div>
  );
}

function ago(ms: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
