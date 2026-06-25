import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { WalletClient } from "viem";

/**
 * useWorkspaceSync — covers the enqueue() chain-swallow at the `.catch(() => {})`
 * (the arrow-fn body that keeps opChain from permanently rejecting). The other
 * test files reject *outside* the enqueued fn (their inner fns have try/catch),
 * so `next` resolves and the swallow never runs. disable()'s enqueued fn awaits
 * apiLogout() with NO inner try/catch — so making apiLogout reject is the most
 * direct way to make the enqueued op (and thus `next`) reject, which is exactly
 * what trips the chain-swallow callback.
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

describe("useWorkspaceSync enqueue chain-swallow", () => {
  it("an enqueued op rejecting is swallowed so the chain stays usable", async () => {
    connectWallet();
    // disable()'s enqueued fn awaits apiLogout() with no inner try/catch, so a
    // rejection propagates out of the enqueued op → `next` rejects → the
    // line-83 .catch swallow fires to keep opChain alive.
    syncClient.apiLogout.mockRejectedValueOnce(new Error("logout boom"));

    const { result } = renderHook(() => useWorkspaceSync(), {
      wrapper: makeWrapper(),
    });

    // The returned promise itself rejects (enqueue returns `next`, not the
    // swallowed chain) — assert that, and flush microtasks so the swallow runs.
    await act(async () => {
      await expect(result.current.disable()).rejects.toThrow("logout boom");
      // Flush any trailing microtasks so opChain.current's .catch settles.
      await Promise.resolve();
    });

    // The chain must not be permanently rejected: a subsequent enqueued op
    // (a successful disable) still runs to completion and lands disabled.
    syncClient.apiLogout.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.disable();
    });
    expect(result.current.status).toEqual({ kind: "disabled" });
  });
});
