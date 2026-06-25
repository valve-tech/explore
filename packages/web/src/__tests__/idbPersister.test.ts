import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * IndexedDB persister for TanStack Query. We mock idb-keyval (get/set/del) so
 * the persistClient/restoreClient/removeClient wiring + the over-cap eviction
 * are tested without a real IndexedDB.
 */

const get = vi.fn();
const set = vi.fn();
const del = vi.fn();

vi.mock("idb-keyval", () => ({
  get: (...a: unknown[]) => get(...a),
  set: (...a: unknown[]) => set(...a),
  del: (...a: unknown[]) => del(...a),
}));

import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { createIdbPersister } from "../lib/idbPersister";

const IDB_KEY = "valvetech-query-cache";

interface TestClient {
  timestamp: number;
  buster: string;
  clientState: {
    mutations: unknown[];
    queries: Array<{
      queryKey: unknown[];
      queryHash: string;
      state: { dataUpdatedAt: number };
    }>;
  };
}

function makeClient(queryCount: number): TestClient {
  return {
    timestamp: 1,
    buster: "",
    clientState: {
      mutations: [],
      queries: Array.from({ length: queryCount }, (_, i) => ({
        queryKey: ["q", i],
        queryHash: `q${i}`,
        state: { dataUpdatedAt: i }, // ascending — oldest first
      })),
    },
  };
}

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  del.mockReset();
});

describe("idbPersister", () => {
  it("persists the client under the IDB key when under the cap", async () => {
    const p = createIdbPersister();
    const client = makeClient(3);
    await p.persistClient(client as unknown as PersistedClient);
    expect(set).toHaveBeenCalledTimes(1);
    const [key, stored] = set.mock.calls[0]!;
    expect(key).toBe(IDB_KEY);
    expect((stored as TestClient).clientState.queries).toHaveLength(3);
  });

  it("evicts the oldest queries down to MAX_QUERIES (1000) before persisting", async () => {
    const p = createIdbPersister();
    const client = makeClient(1003);
    await p.persistClient(client as unknown as PersistedClient);
    const [, stored] = set.mock.calls[0]!;
    const kept = (stored as TestClient).clientState.queries;
    expect(kept).toHaveLength(1000);
    // newest retained — the three oldest (dataUpdatedAt 0,1,2) were dropped.
    expect(kept[0]!.state.dataUpdatedAt).toBe(3);
    expect(kept.at(-1)!.state.dataUpdatedAt).toBe(1002);
  });

  it("restores via get", async () => {
    const stub = { restored: true };
    get.mockResolvedValue(stub);
    const p = createIdbPersister();
    const restored = await p.restoreClient();
    expect(get).toHaveBeenCalledWith(IDB_KEY);
    expect(restored).toBe(stub);
  });

  it("removes via del", async () => {
    const p = createIdbPersister();
    await p.removeClient();
    expect(del).toHaveBeenCalledWith(IDB_KEY);
  });
});
