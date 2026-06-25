import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Supplements watcher.test.ts — covers the IDB-backed loadMatches/persistMatches
 * in watcher/log.ts (mocked idb-keyval) and the genId fallback path in toMatch
 * when crypto.randomUUID isn't available.
 */

const get = vi.fn();
const set = vi.fn();
vi.mock("idb-keyval", () => ({
  get: (...a: unknown[]) => get(...a),
  set: (...a: unknown[]) => set(...a),
}));

import { loadMatches, persistMatches, toMatch } from "../lib/watcher/log";
import { buildRule } from "../lib/watcher/rules";
import { EMPTY_LOG_STORE, type WatchMatch } from "../lib/watcher/types";

const IDB_KEY = "valvetech-watch-log";

beforeEach(() => {
  get.mockReset();
  set.mockReset();
});
afterEach(() => vi.restoreAllMocks());

const rule = buildRule({
  workspaceId: "w",
  chainId: 369,
  kind: "address_activity",
  address: "0xaaaa000000000000000000000000000000000001",
});

describe("watcher/log — loadMatches", () => {
  it("returns the empty default when nothing is stored", async () => {
    get.mockResolvedValue(undefined);
    expect(await loadMatches()).toEqual(EMPTY_LOG_STORE.matches);
    expect(get).toHaveBeenCalledWith(IDB_KEY);
  });

  it("returns the empty default for a wrong schema version", async () => {
    get.mockResolvedValue({ schemaVersion: 2, matches: [{ id: "x" }] });
    expect(await loadMatches()).toEqual(EMPTY_LOG_STORE.matches);
  });

  it("returns the stored matches when schema matches", async () => {
    const matches = [{ id: "m1" }] as unknown as WatchMatch[];
    get.mockResolvedValue({ schemaVersion: 1, matches });
    expect(await loadMatches()).toBe(matches);
  });
});

describe("watcher/log — persistMatches", () => {
  it("writes a schema-stamped store under the IDB key", async () => {
    const matches = [toMatch(rule, { lead: "a", amount: null, trail: "", txHash: "0x1" })];
    await persistMatches(matches);
    expect(set).toHaveBeenCalledWith(IDB_KEY, { schemaVersion: 1, matches });
  });
});

describe("watcher/log — toMatch genId fallback", () => {
  it("generates a non-crypto id when crypto.randomUUID is unavailable", () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      const m = toMatch(rule, { lead: "x", amount: null, trail: "", txHash: "0x1" });
      expect(m.id).toMatch(/^wm-/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: orig,
        configurable: true,
      });
    }
  });
});
