import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * WorkspaceSyncStatus — topbar widget reflecting the workspace-sync state
 * machine. We mock useWalletSigner (connected/disconnected) and
 * useWorkspaceSync (each status.kind) to render every branch: disabled,
 * authenticating / pulling / pushing spinner, in-sync, conflict (with
 * resolve), and error (with retry).
 *
 * A connected wallet is an EOA. Chain explorer: https://scan.pulsechain.com
 */

const useWalletSigner = vi.fn();
const useWorkspaceSync = vi.fn();

vi.mock("../hooks/useWalletSigner", () => ({
  useWalletSigner: () => useWalletSigner(),
}));
vi.mock("../hooks/useWorkspaceSync", () => ({
  useWorkspaceSync: () => useWorkspaceSync(),
}));

import { WorkspaceSyncStatus } from "../components/wallet/WorkspaceSyncStatus";

const enable = vi.fn();
const resolveConflict = vi.fn();

function setSync(status: Record<string, unknown>) {
  useWorkspaceSync.mockReturnValue({ status, enable, resolveConflict });
}

beforeEach(() => {
  vi.clearAllMocks();
  useWalletSigner.mockReturnValue({ isConnected: true });
});

describe("WorkspaceSyncStatus", () => {
  it("renders nothing when no wallet is connected", () => {
    useWalletSigner.mockReturnValue({ isConnected: false });
    setSync({ kind: "disabled" });
    const { container } = render(<WorkspaceSyncStatus />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the Enable sync button when disabled and fires enable()", () => {
    setSync({ kind: "disabled" });
    render(<WorkspaceSyncStatus />);
    const btn = screen.getByRole("button", { name: /enable sync/i });
    fireEvent.click(btn);
    expect(enable).toHaveBeenCalled();
  });

  it("shows 'Signing in…' while authenticating", () => {
    setSync({ kind: "authenticating" });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("Signing in…")).toBeInTheDocument();
  });

  it("shows 'Syncing…' while pulling", () => {
    setSync({ kind: "pulling" });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();
  });

  it("shows 'Saving…' while pushing", () => {
    setSync({ kind: "pushing" });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("shows Synced when in-sync", () => {
    setSync({ kind: "in-sync", serverUpdatedAt: Date.now() });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("renders a conflict and resolves to local or remote", () => {
    setSync({
      kind: "conflict",
      local: { workspaces: [{ id: 1 }] },
      remote: { workspaces: [{ id: 1 }, { id: 2 }] },
    });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("Conflict")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /keep local/i }));
    expect(resolveConflict).toHaveBeenCalledWith("local");
    fireEvent.click(screen.getByRole("button", { name: /use server/i }));
    expect(resolveConflict).toHaveBeenCalledWith("remote");
  });

  it("renders an error with a Retry button", () => {
    setSync({ kind: "error", message: "sync exploded" });
    render(<WorkspaceSyncStatus />);
    expect(screen.getByText("sync exploded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(enable).toHaveBeenCalled();
  });
});
