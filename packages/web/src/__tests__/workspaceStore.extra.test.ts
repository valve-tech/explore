import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Supplements workspace.test.ts — covers the thin IDB wrappers in
 * workspace/store.ts (loadStore / saveStore / persistWorkspaces, mocked
 * idb-keyval) and the genId fallback in createWorkspace.
 */

const get = vi.fn();
const set = vi.fn();
vi.mock("idb-keyval", () => ({
  get: (...a: unknown[]) => get(...a),
  set: (...a: unknown[]) => set(...a),
}));

import {
  loadStore,
  saveStore,
  persistWorkspaces,
  createWorkspace,
} from "../lib/workspace/store";
import { EMPTY_STORE, type WorkspaceStore } from "../lib/workspace/types";

const IDB_KEY = "valvetech-workspaces";

beforeEach(() => {
  get.mockReset();
  set.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("workspace/store — loadStore", () => {
  it("returns the empty store with nothing persisted", async () => {
    get.mockResolvedValue(undefined);
    expect(await loadStore()).toEqual(EMPTY_STORE);
    expect(get).toHaveBeenCalledWith(IDB_KEY);
  });

  it("returns the empty store on a wrong schema version", async () => {
    get.mockResolvedValue({ schemaVersion: 2, workspaces: [] });
    expect(await loadStore()).toEqual(EMPTY_STORE);
  });

  it("normalizes a loaded store (backfills missing chainId to 369)", async () => {
    const stored: WorkspaceStore = {
      schemaVersion: 1,
      workspaces: [
        {
          id: "w1",
          name: "ws",
          createdAt: 1,
          updatedAt: 1,
          items: [
            // chainId omitted — predates multichain.
            { id: "i1", kind: "address", value: "0xabc", addedAt: 1 } as never,
          ],
        },
      ],
    };
    get.mockResolvedValue(stored);
    const out = await loadStore();
    expect(out.workspaces[0]!.items[0]!.chainId).toBe(369);
  });
});

describe("workspace/store — saveStore / persistWorkspaces", () => {
  it("saveStore writes the blob under the IDB key", async () => {
    await saveStore(EMPTY_STORE);
    expect(set).toHaveBeenCalledWith(IDB_KEY, EMPTY_STORE);
  });

  it("persistWorkspaces wraps with a schema version", async () => {
    await persistWorkspaces([]);
    expect(set).toHaveBeenCalledWith(IDB_KEY, { schemaVersion: 1, workspaces: [] });
  });
});

describe("workspace/store — createWorkspace genId fallback", () => {
  it("uses a non-crypto id when crypto.randomUUID is unavailable", () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ws = createWorkspace("  My WS  ", "  desc  ");
      expect(ws.id).toMatch(/^ws-/);
      expect(ws.name).toBe("My WS");
      expect(ws.description).toBe("desc");
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: orig, configurable: true });
    }
  });
});
