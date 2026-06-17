import { Icon } from "@iconify/react";
import { useWorkspaceSync } from "../../hooks/useWorkspaceSync";
import { useWalletSigner } from "../../hooks/useWalletSigner";
import { Tooltip } from "../primitives/Tooltip";

/**
 * Topbar widget that reflects the workspace-sync state.
 *
 * Renders nothing when no wallet is connected — the WalletConnectButton
 * handles that copy. When connected, shows one of:
 *
 *   - disabled       → "Enable sync" button.
 *   - authenticating → spinner + "Signing in…".
 *   - pulling        → spinner + "Syncing…".
 *   - pushing        → spinner + "Saving…".
 *   - in-sync        → green dot + "Synced".
 *   - conflict       → red dot + "Conflict" with a "Resolve…" button that
 *                       opens an inline picker between local and remote.
 *   - error          → red dot + the error message.
 *
 * The conflict UI is deliberately blocking — users must pick local or
 * remote before any further sync activity. A "merge later" affordance is
 * deferred until usage proves it's needed; for now the binary choice
 * keeps the state machine small.
 */
export function WorkspaceSyncStatus() {
  const { isConnected } = useWalletSigner();
  const { status, enable, resolveConflict } = useWorkspaceSync();

  if (!isConnected) return null;

  if (status.kind === "disabled") {
    return (
      <Tooltip label="Sign a message to enable cross-device workspace sync">
        <button
          type="button"
          onClick={() => void enable()}
          className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-tertiary-bg theme-text-secondary"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        >
          <Icon icon="heroicons:cloud-arrow-up" className="w-3.5 h-3.5" />
          Enable sync
        </button>
      </Tooltip>
    );
  }

  if (status.kind === "authenticating" || status.kind === "pulling" || status.kind === "pushing") {
    const label =
      status.kind === "authenticating"
        ? "Signing in…"
        : status.kind === "pulling"
          ? "Syncing…"
          : "Saving…";
    return (
      <div
        className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-tertiary-bg theme-text-secondary"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
      >
        <Icon icon="heroicons:arrow-path" className="w-3.5 h-3.5 animate-spin" />
        {label}
      </div>
    );
  }

  if (status.kind === "in-sync") {
    return (
      <Tooltip label={`Last server update ${new Date(status.serverUpdatedAt).toLocaleString()}`}>
        <div
          className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-tertiary-bg theme-text-secondary"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-border-muted)" }}
        >
          <span className="w-2 h-2 theme-success-bg" />
          Synced
        </div>
      </Tooltip>
    );
  }

  if (status.kind === "conflict") {
    const localCount = status.local.workspaces.length;
    const remoteCount = status.remote.workspaces.length;
    return (
      <div
        className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-danger-bg theme-danger"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-danger)" }}
      >
        <Icon icon="heroicons:exclamation-triangle" className="w-3.5 h-3.5" />
        <span>Conflict</span>
        <Tooltip
          label={`Keep this device's ${localCount} workspace${localCount === 1 ? "" : "s"}`}
          className="ml-2"
        >
          <button
            type="button"
            onClick={() => void resolveConflict("local")}
            className="px-2 py-0.5 theme-text"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          >
            Keep local
          </button>
        </Tooltip>
        <Tooltip
          label={`Use the server's ${remoteCount} workspace${remoteCount === 1 ? "" : "s"}`}
        >
          <button
            type="button"
            onClick={() => void resolveConflict("remote")}
            className="px-2 py-0.5 theme-text"
            style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          >
            Use server
          </button>
        </Tooltip>
      </div>
    );
  }

  // status.kind === "error"
  return (
    <Tooltip label={status.message}>
      <div
        className="text-xs px-3 py-1.5 inline-flex items-center gap-tight theme-danger-bg theme-danger"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-danger)" }}
      >
        <Icon icon="heroicons:x-circle" className="w-3.5 h-3.5" />
        <span className="max-w-[14ch] truncate">{status.message}</span>
        <button
          type="button"
          onClick={() => void enable()}
          className="ml-2 px-2 py-0.5 theme-text"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
        >
          Retry
        </button>
      </div>
    </Tooltip>
  );
}
