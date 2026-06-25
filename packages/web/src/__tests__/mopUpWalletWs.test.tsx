import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { WalletClient } from "viem";

/**
 * Coverage mop-up for the wallet / workspace-sync surface. Each block below
 * targets a specific guard arm the broader suites don't reach:
 *
 *   - useWorkspaceSync: the `if (!signer) return` guards in pushIfDirty /
 *     resolveConflict, plus the non-conflict early-return in resolveConflict.
 *   - useWatchRules: the `query.data ?? (await loadRules())` nullish arm, hit
 *     when a mutation fires before the query has resolved.
 *   - WorkspaceSyncAutoPush: re-render with the same already-hydrated address,
 *     the cancelled-hydrate short-circuit, and the "timer already pending"
 *     clearTimeout arm on a second schedule.
 *   - WalletConnectButton: connected account with a still-undefined address →
 *     the empty-string fallback for the truncated chip.
 *
 * Self-contained mock controllers so no wagmi providers / IDB are needed.
 */

// ===========================================================================
// useWorkspaceSync — signer-null guards + non-conflict resolveConflict
// ===========================================================================

const wsMocks = vi.hoisted(() => {
  const walletState: {
    signer: unknown;
    address: `0x${string}` | undefined;
    isConnected: boolean;
  } = { signer: null, address: undefined, isConnected: false };
  return { walletState };
});

vi.mock("../hooks/useWalletSigner", () => ({
  useWalletSigner: () => wsMocks.walletState,
}));

// The sync libs are static imports of the hook; stub them to inert no-ops so a
// stray call can't reach IDB / crypto. The tests here all return BEFORE these
// would fire, but mocking keeps the module graph free of browser-only deps.
vi.mock("../lib/workspace/store", () => ({
  loadStore: async () => ({ schemaVersion: 1, workspaces: [] }),
  persistWorkspaces: async () => {},
}));
vi.mock("../lib/workspace/sync", () => ({
  getWorkspaceKey: vi.fn(),
  encryptStoreEnvelope: vi.fn(),
  decryptStoreEnvelope: vi.fn(),
  _resetKeyCacheForTests: vi.fn(),
}));
vi.mock("../lib/workspace/syncClient", () => ({
  authenticate: vi.fn(),
  pullSync: vi.fn(),
  pushSync: vi.fn(),
  logout: vi.fn(),
  SyncUnauthorized: class SyncUnauthorized extends Error {},
}));

// useWorkspaceSync is consumed two ways in this file:
//   1. directly as the hook-under-test (the real implementation), and
//   2. as a dependency of WorkspaceSyncAutoPush (which wants a stub).
// One vi.mock per module is hoisted file-wide, so we make the mock delegate to
// the REAL hook unless a per-test override is installed via `autoSyncOverride`.
const syncHookCtl = vi.hoisted(() => ({
  override: null as null | (() => unknown),
}));

vi.mock("../hooks/useWorkspaceSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useWorkspaceSync")>();
  return {
    ...actual,
    useWorkspaceSync: () =>
      syncHookCtl.override ? syncHookCtl.override() : actual.useWorkspaceSync(),
  };
});

import { useWorkspaceSync } from "../hooks/useWorkspaceSync";

function syncWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useWorkspaceSync — guard arms", () => {
  beforeEach(() => {
    wsMocks.walletState.signer = null;
    wsMocks.walletState.address = undefined;
    wsMocks.walletState.isConnected = false;
  });

  it("pushIfDirty returns early when there is no signer (line 147)", async () => {
    const { result } = renderHook(() => useWorkspaceSync(), { wrapper: syncWrapper() });
    await act(async () => {
      await result.current.pushIfDirty();
    });
    // No status change — still disabled, no throw.
    expect(result.current.status.kind).toBe("disabled");
  });

  it("resolveConflict returns early when there is no signer (line 179)", async () => {
    const { result } = renderHook(() => useWorkspaceSync(), { wrapper: syncWrapper() });
    await act(async () => {
      await result.current.resolveConflict("remote");
    });
    expect(result.current.status.kind).toBe("disabled");
  });

  it("resolveConflict returns early when status is not a conflict (line 180)", async () => {
    // Signer present but status is the initial "disabled" — passes the !signer
    // guard, then bails on the kind check.
    wsMocks.walletState.signer = {} as WalletClient;
    wsMocks.walletState.address = "0xabc";
    wsMocks.walletState.isConnected = true;
    const { result } = renderHook(() => useWorkspaceSync(), { wrapper: syncWrapper() });
    await act(async () => {
      await result.current.resolveConflict("remote");
    });
    expect(result.current.status.kind).toBe("disabled");
  });
});

// ===========================================================================
// useWatchRules — nullish loadRules() arm when mutating before query resolves
// ===========================================================================

const ruleMocks = vi.hoisted(() => ({
  loadRules: vi.fn(),
  persistRules: vi.fn(),
  buildRule: vi.fn(),
  toggleRule: vi.fn(),
  removeRule: vi.fn(),
  setEnabledForWorkspace: vi.fn(),
}));

vi.mock("../lib/watcher/rules", () => ({
  loadRules: (...a: unknown[]) => ruleMocks.loadRules(...a),
  persistRules: (...a: unknown[]) => ruleMocks.persistRules(...a),
  buildRule: (...a: unknown[]) => ruleMocks.buildRule(...a),
  toggleRule: (...a: unknown[]) => ruleMocks.toggleRule(...a),
  removeRule: (...a: unknown[]) => ruleMocks.removeRule(...a),
  setEnabledForWorkspace: (...a: unknown[]) => ruleMocks.setEnabledForWorkspace(...a),
}));

import { useWatchRules } from "../hooks/useWatchRules";

describe("useWatchRules — mutate before the query resolves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ruleMocks.persistRules.mockResolvedValue(undefined);
  });

  it("falls back to loadRules() when query.data is still undefined (lines 36-38)", async () => {
    const RULE = { id: "r1", workspaceId: "ws1" };
    // First loadRules call is the TanStack query — keep it pending forever so
    // query.data stays undefined. The SECOND call is mutate's own snapshot
    // (the `query.data ?? (await loadRules())` nullish arm), which resolves.
    ruleMocks.loadRules.mockReturnValueOnce(new Promise<unknown[]>(() => {}));
    ruleMocks.loadRules.mockResolvedValue([]);
    ruleMocks.buildRule.mockReturnValue(RULE);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useWatchRules(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    // Query is still loading (its loadRules never resolves) → query.data is
    // undefined when the mutation fires.
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await result.current.add.mutateAsync({
        workspaceId: "ws1",
        chainId: 369,
        kind: "address_activity",
      });
    });

    // mutate's own `await loadRules()` ran (the nullish arm) → loadRules was
    // called beyond the initial query, and the prepended rule was persisted
    // against the freshly-loaded list.
    expect(ruleMocks.loadRules.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(ruleMocks.persistRules).toHaveBeenCalledWith([RULE]);
  });
});

// ===========================================================================
// WorkspaceSyncAutoPush — same-address re-render, cancelled hydrate, timer arm
// ===========================================================================

const autoMocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  useWorkspaceSync: vi.fn(),
  loadWatermark: vi.fn(),
  saveWatermark: vi.fn(),
  pushIfDirty: vi.fn(),
}));

vi.mock("../hooks/useWorkspaces", () => ({
  useWorkspaces: () => autoMocks.useWorkspaces(),
}));
vi.mock("../lib/workspace/syncWatermark", () => ({
  loadWatermark: (...a: unknown[]) => autoMocks.loadWatermark(...a),
  saveWatermark: (...a: unknown[]) => autoMocks.saveWatermark(...a),
}));

import { WorkspaceSyncAutoPush } from "../components/wallet/WorkspaceSyncAutoPush";

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

describe("WorkspaceSyncAutoPush — extra guard arms", () => {
  beforeEach(() => {
    autoMocks.useWorkspaces.mockReset();
    autoMocks.useWorkspaceSync.mockReset();
    autoMocks.loadWatermark.mockReset();
    autoMocks.saveWatermark.mockReset();
    autoMocks.pushIfDirty.mockReset();
    autoMocks.pushIfDirty.mockResolvedValue(undefined);
    autoMocks.saveWatermark.mockResolvedValue(undefined);
    autoMocks.loadWatermark.mockResolvedValue(0);
    // Route the file-wide useWorkspaceSync mock to AutoPush's stub for this
    // block only (the guard-arm block above leaves override null → real hook).
    syncHookCtl.override = () => autoMocks.useWorkspaceSync();
    // AutoPush reads address from useWalletSigner, which the top-level vi.mock
    // wired to wsMocks.walletState. Point it at the connected address.
    wsMocks.walletState.address = ADDR;
  });

  afterEach(() => {
    vi.useRealTimers();
    syncHookCtl.override = null;
    wsMocks.walletState.address = undefined;
  });

  it("skips a second hydrate when re-rendered with the same address (line 47)", async () => {
    autoMocks.useWorkspaces.mockReturnValue({ workspaces: [] });
    autoMocks.useWorkspaceSync.mockReturnValue({
      status: { kind: "disabled" },
      pushIfDirty: autoMocks.pushIfDirty,
    });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    await waitFor(() => expect(autoMocks.loadWatermark).toHaveBeenCalledTimes(1));
    // Re-render with the SAME address still connected. The hydrate effect runs
    // again (deps unchanged but rerender forces React to re-evaluate) and hits
    // `if (hydratedFor.current === address) return` — no second load.
    rerender(<WorkspaceSyncAutoPush />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(autoMocks.loadWatermark).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a stale hydrate that resolves after the address changed (line 50)", async () => {
    let resolveLoad: (v: number) => void = () => {};
    autoMocks.loadWatermark.mockImplementationOnce(
      () => new Promise<number>((res) => { resolveLoad = res; }),
    );
    autoMocks.loadWatermark.mockResolvedValue(0);
    autoMocks.useWorkspaces.mockReturnValue({ workspaces: [] });
    autoMocks.useWorkspaceSync.mockReturnValue({
      status: { kind: "disabled" },
      pushIfDirty: autoMocks.pushIfDirty,
    });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    // Switch wallet before the first load resolves → first effect cleanup sets
    // cancelled = true.
    const ADDR2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
    wsMocks.walletState.address = ADDR2;
    rerender(<WorkspaceSyncAutoPush />);
    // Resolve the stale load — its body hits `if (cancelled) return`.
    await act(async () => {
      resolveLoad(99);
      await Promise.resolve();
    });
    expect(autoMocks.loadWatermark).toHaveBeenCalledWith(ADDR2);
  });

  it("clears an already-pending debounce timer when a new push schedules (line 73)", async () => {
    autoMocks.loadWatermark.mockResolvedValue(0);
    autoMocks.useWorkspaceSync.mockReturnValue({
      status: { kind: "in-sync" },
      pushIfDirty: autoMocks.pushIfDirty,
    });
    autoMocks.useWorkspaces.mockReturnValue({ workspaces: [] });

    const { rerender } = render(<WorkspaceSyncAutoPush />);
    // flush hydrate so hydratedFor === address
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.useFakeTimers();
    // First edit → schedules a timer (timer.current was null).
    autoMocks.useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 100 }] });
    rerender(<WorkspaceSyncAutoPush />);
    // Second edit BEFORE the debounce fires → timer.current is truthy, so the
    // schedule clears the pending timer first (line 73 true arm).
    autoMocks.useWorkspaces.mockReturnValue({ workspaces: [{ updatedAt: 200 }] });
    rerender(<WorkspaceSyncAutoPush />);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(autoMocks.saveWatermark).toHaveBeenLastCalledWith(ADDR, 200);
    // Only the final scheduled push fires (the first timer was cleared).
    expect(autoMocks.pushIfDirty).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// WalletConnectButton — connected but address undefined → empty chip (br@96)
// ===========================================================================

const wcMocks = vi.hoisted(() => ({
  useAccount: vi.fn(),
  useConnect: vi.fn(),
  useDisconnect: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => wcMocks.useAccount(),
  useConnect: () => wcMocks.useConnect(),
  useDisconnect: () => wcMocks.useDisconnect(),
}));

import { WalletConnectButton } from "../components/wallet/WalletConnectButton";

describe("WalletConnectButton — connected with no address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wcMocks.useDisconnect.mockReturnValue({ disconnect: vi.fn() });
    wcMocks.useConnect.mockReturnValue({
      connectors: [{ id: "injected" }],
      connectAsync: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    });
  });

  it("renders an empty chip label when connected but address is undefined (branch 96)", () => {
    // isConnected true but address momentarily undefined → addressShort falls to
    // the "" branch of the ternary.
    wcMocks.useAccount.mockReturnValue({ isConnected: true, address: undefined });
    const { container } = render(<WalletConnectButton />);
    // The chip button still renders; its label resolves to "" so only the icon
    // remains. No throw, and we're not in the "Connect wallet" disconnected UI.
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.textContent).not.toMatch(/Connect wallet/);
  });
});
