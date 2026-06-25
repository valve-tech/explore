import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

/**
 * WorkspaceSyncAutoPush — headless driver that debounce-pushes the encrypted
 * workspace envelope to the server when the local IDB store changes and the
 * connected wallet's watermark has advanced. We mock the three hooks plus the
 * watermark persistence helpers to drive: no-wallet reset, hydrate-on-address,
 * the schedule-then-push happy path, and the max<=lastSeen short-circuit.
 *
 * A connected wallet is an EOA. Chain explorer: https://scan.pulsechain.com
 */

const useWorkspaces = vi.fn();
const useWorkspaceSync = vi.fn();
const useWalletSigner = vi.fn();
const loadWatermark = vi.fn();
const saveWatermark = vi.fn();
const pushIfDirty = vi.fn();

vi.mock("../hooks/useWorkspaces", () => ({ useWorkspaces: () => useWorkspaces() }));
vi.mock("../hooks/useWorkspaceSync", () => ({ useWorkspaceSync: () => useWorkspaceSync() }));
vi.mock("../hooks/useWalletSigner", () => ({ useWalletSigner: () => useWalletSigner() }));
vi.mock("../lib/workspace/syncWatermark", () => ({
  loadWatermark: (...a: unknown[]) => loadWatermark(...a),
  saveWatermark: (...a: unknown[]) => saveWatermark(...a),
}));

import { WorkspaceSyncAutoPush } from "../components/wallet/WorkspaceSyncAutoPush";

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

beforeEach(() => {
  vi.clearAllMocks();
  pushIfDirty.mockResolvedValue(undefined);
  saveWatermark.mockResolvedValue(undefined);
  loadWatermark.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceSyncAutoPush", () => {
  it("renders nothing (headless)", () => {
    useWorkspaces.mockReturnValue({ workspaces: [] });
    useWorkspaceSync.mockReturnValue({ status: { kind: "disabled" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: undefined });
    const { container } = render(<WorkspaceSyncAutoPush />);
    expect(container.firstChild).toBeNull();
  });

  it("does not hydrate or push without a wallet", () => {
    useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 5 }] });
    useWorkspaceSync.mockReturnValue({ status: { kind: "in-sync" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: undefined });
    render(<WorkspaceSyncAutoPush />);
    expect(loadWatermark).not.toHaveBeenCalled();
    expect(pushIfDirty).not.toHaveBeenCalled();
  });

  it("hydrates the watermark when an address connects", async () => {
    useWorkspaces.mockReturnValue({ workspaces: [] });
    useWorkspaceSync.mockReturnValue({ status: { kind: "disabled" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });
    render(<WorkspaceSyncAutoPush />);
    await waitFor(() => expect(loadWatermark).toHaveBeenCalledWith(ADDR));
  });

  it("schedules and fires a debounced push after the watermark advances", async () => {
    loadWatermark.mockResolvedValue(0);
    useWorkspaceSync.mockReturnValue({ status: { kind: "in-sync" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });
    // Start empty so the watermark hydrates before any change is observed.
    useWorkspaces.mockReturnValue({ workspaces: [] });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    // flush the hydrate promise so hydratedFor === address
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now a local edit lands: re-render with an advanced updatedAt. This is
    // the schedule path — max (100) > lastSeen (0).
    vi.useFakeTimers();
    useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 100 }] });
    rerender(<WorkspaceSyncAutoPush />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(saveWatermark).toHaveBeenCalledWith(ADDR, 100);
    expect(pushIfDirty).toHaveBeenCalled();
  });

  it("does not push when the max updatedAt is not above the watermark", async () => {
    loadWatermark.mockResolvedValue(500);
    useWorkspaceSync.mockReturnValue({ status: { kind: "in-sync" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });
    useWorkspaces.mockReturnValue({ workspaces: [] });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // max (100) <= lastSeen (500) → no schedule
    vi.useFakeTimers();
    useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 100 }] });
    rerender(<WorkspaceSyncAutoPush />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(pushIfDirty).not.toHaveBeenCalled();
  });

  it("cancels an in-flight hydrate when the address changes (cleanup path)", async () => {
    let resolveLoad: (v: number) => void = () => {};
    loadWatermark.mockImplementation(
      () => new Promise<number>((res) => { resolveLoad = res; }),
    );
    useWorkspaces.mockReturnValue({ workspaces: [] });
    useWorkspaceSync.mockReturnValue({ status: { kind: "disabled" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    // switch wallets before the first load resolves → cleanup sets cancelled
    const ADDR2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    useWalletSigner.mockReturnValue({ address: ADDR2 });
    rerender(<WorkspaceSyncAutoPush />);
    // resolve the stale load — its `if (cancelled) return` short-circuits
    await act(async () => {
      resolveLoad(99);
      await Promise.resolve();
    });
    expect(loadWatermark).toHaveBeenCalledWith(ADDR2);
  });

  it("clears the pending debounce timer on unmount (cleanup path)", async () => {
    loadWatermark.mockResolvedValue(0);
    useWorkspaceSync.mockReturnValue({ status: { kind: "in-sync" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });
    useWorkspaces.mockReturnValue({ workspaces: [] });

    const { rerender, unmount } = render(<WorkspaceSyncAutoPush />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.useFakeTimers();
    useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 100 }] });
    rerender(<WorkspaceSyncAutoPush />);
    // unmount before the debounce fires → timer is cleared, no push
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(pushIfDirty).not.toHaveBeenCalled();
  });

  it("does nothing while status is not in-sync", () => {
    useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 100 }] });
    useWorkspaceSync.mockReturnValue({ status: { kind: "pulling" }, pushIfDirty });
    useWalletSigner.mockReturnValue({ address: ADDR });
    render(<WorkspaceSyncAutoPush />);
    expect(pushIfDirty).not.toHaveBeenCalled();
  });
});
