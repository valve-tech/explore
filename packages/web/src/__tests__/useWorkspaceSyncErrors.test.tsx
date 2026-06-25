import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { WalletClient } from "viem";

/**
 * useWorkspaceSync — error-catch branches not exercised by
 * useWorkspaceSync.test.tsx: enable()'s catch (authenticate throws),
 * pushIfDirty()'s non-Unauthorized catch (pushSync throws a plain Error),
 * and resolveConflict()'s catch (encrypt/push throws). Same vi.hoisted mock
 * shape as the main file, kept separate so the existing file stays untouched.
 */

const FAKE_SIGNER = {} as WalletClient;

const mocks = vi.hoisted(() => {
  class SyncUnauthorized extends Error {
    constructor() {
      super("unauthorized");
    }
  }
  const walletState: {
    signer: unknown;
    address: `0x${string}` | undefined;
    isConnected: boolean;
  } = { signer: null, address: undefined, isConnected: false };
  const storeState = {
    current: { schemaVersion: 1 as const, workspaces: [] as unknown[] },
    persisted: [] as unknown[],
  };
  return {
    SyncUnauthorized,
    walletState,
    storeState,
    syncClient: {
      authenticate: vi.fn(),
      pullSync: vi.fn(),
      pushSync: vi.fn(),
      apiLogout: vi.fn(),
    },
    syncLib: {
      getWorkspaceKey: vi.fn(),
      encryptStoreEnvelope: vi.fn(),
      decryptStoreEnvelope: vi.fn(),
      resetKeyCache: vi.fn(),
    },
  };
});

vi.mock("../hooks/useWalletSigner", () => ({
  useWalletSigner: () => mocks.walletState,
}));
vi.mock("../lib/workspace/store", () => ({
  loadStore: async () => mocks.storeState.current,
  persistWorkspaces: async (ws: unknown[]) => {
    mocks.storeState.persisted.push(ws);
    mocks.storeState.current = { schemaVersion: 1, workspaces: ws };
  },
}));
vi.mock("../lib/workspace/sync", () => ({
  getWorkspaceKey: mocks.syncLib.getWorkspaceKey,
  encryptStoreEnvelope: mocks.syncLib.encryptStoreEnvelope,
  decryptStoreEnvelope: mocks.syncLib.decryptStoreEnvelope,
  _resetKeyCacheForTests: mocks.syncLib.resetKeyCache,
}));
vi.mock("../lib/workspace/syncClient", () => ({
  authenticate: mocks.syncClient.authenticate,
  pullSync: mocks.syncClient.pullSync,
  pushSync: mocks.syncClient.pushSync,
  logout: mocks.syncClient.apiLogout,
  SyncUnauthorized: mocks.SyncUnauthorized,
}));

import { useWorkspaceSync } from "../hooks/useWorkspaceSync";

const { walletState, storeState, syncClient, syncLib } = mocks;

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function connectWallet() {
  walletState.signer = FAKE_SIGNER;
  walletState.address = "0xabc";
  walletState.isConnected = true;
}

beforeEach(() => {
  walletState.signer = null;
  walletState.address = undefined;
  walletState.isConnected = false;
  storeState.current = { schemaVersion: 1, workspaces: [] };
  storeState.persisted = [];
  vi.resetAllMocks();
  syncClient.pullSync.mockResolvedValue(null);
  syncClient.authenticate.mockResolvedValue(undefined);
  syncClient.apiLogout.mockResolvedValue(undefined);
  syncClient.pushSync.mockResolvedValue({ serverUpdatedAt: 100 });
  syncLib.getWorkspaceKey.mockResolvedValue({} as CryptoKey);
  syncLib.encryptStoreEnvelope.mockResolvedValue({
    ciphertext: "c",
    nonce: "n",
    envelopeFormat: 1,
    keyVersion: 1,
    updatedAt: 0,
  });
  syncLib.decryptStoreEnvelope.mockResolvedValue(storeState.current);
});

describe("useWorkspaceSync error paths", () => {
  it("enable(): authenticate throwing lands in error state", async () => {
    connectWallet();
    syncClient.authenticate.mockRejectedValue(new Error("auth boom"));
    const { result } = renderHook(() => useWorkspaceSync(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.enable();
    });
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "error",
        message: "auth boom",
      }),
    );
  });

  it("enable(): non-Error throw uses the generic 'sync failed' message", async () => {
    connectWallet();
    syncClient.authenticate.mockRejectedValue("nope");
    const { result } = renderHook(() => useWorkspaceSync(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.enable();
    });
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "error",
        message: "sync failed",
      }),
    );
  });

  it("pushIfDirty(): a plain push error lands in error (not disabled)", async () => {
    connectWallet();
    // First enable lands in-sync (no remote → first push succeeds).
    const { result } = renderHook(() => useWorkspaceSync(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.enable();
    });
    await waitFor(() => expect(result.current.status.kind).toBe("in-sync"));

    // Advance local past the cursor so pushIfDirty actually pushes, then fail.
    storeState.current = {
      schemaVersion: 1,
      workspaces: [{ id: "w", updatedAt: 999 }],
    };
    syncClient.pushSync.mockRejectedValueOnce(new Error("push boom"));
    await act(async () => {
      await result.current.pushIfDirty();
    });
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "error",
        message: "push boom",
      }),
    );
  });

  it("resolveConflict(): an encrypt error lands in error state", async () => {
    connectWallet();
    // Force a conflict: server has a blob with a different updatedAt than local.
    syncClient.pullSync.mockResolvedValue({
      ciphertext: "c",
      nonce: "n",
      envelopeFormat: 1,
      keyVersion: 1,
      updatedAt: 42,
      serverUpdatedAt: 42,
    });
    syncLib.decryptStoreEnvelope.mockResolvedValue({
      schemaVersion: 1,
      workspaces: [{ id: "r", updatedAt: 42 }],
    });
    const { result } = renderHook(() => useWorkspaceSync(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.enable();
    });
    await waitFor(() => expect(result.current.status.kind).toBe("conflict"));

    // 'local' winner path re-encrypts → make encrypt throw.
    syncLib.encryptStoreEnvelope.mockRejectedValueOnce(new Error("enc boom"));
    await act(async () => {
      await result.current.resolveConflict("local");
    });
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "error",
        message: "enc boom",
      }),
    );
  });
});
