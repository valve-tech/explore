import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Supplements watcher.test.ts — covers the IDB-backed loadRules/persistRules in
 * watcher/rules.ts (mocked idb-keyval), the genId fallback in buildRule, and the
 * erc20_transfer branch of ruleLabel in watcher/types.ts.
 */

const get = vi.fn();
const set = vi.fn();
vi.mock("idb-keyval", () => ({
  get: (...a: unknown[]) => get(...a),
  set: (...a: unknown[]) => set(...a),
}));

import { loadRules, persistRules, buildRule } from "../lib/watcher/rules";
import { EMPTY_RULE_STORE, ruleLabel, type WatchRule } from "../lib/watcher/types";

const IDB_KEY = "valvetech-watch-rules";

beforeEach(() => {
  get.mockReset();
  set.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("watcher/rules — loadRules", () => {
  it("returns the empty default with nothing stored", async () => {
    get.mockResolvedValue(undefined);
    expect(await loadRules()).toEqual(EMPTY_RULE_STORE.rules);
    expect(get).toHaveBeenCalledWith(IDB_KEY);
  });

  it("returns the empty default on a wrong schema version", async () => {
    get.mockResolvedValue({ schemaVersion: 99, rules: [{ id: "x" }] });
    expect(await loadRules()).toEqual(EMPTY_RULE_STORE.rules);
  });

  it("returns stored rules when the schema matches", async () => {
    const rules = [{ id: "r1" }] as unknown as WatchRule[];
    get.mockResolvedValue({ schemaVersion: 1, rules });
    expect(await loadRules()).toBe(rules);
  });
});

describe("watcher/rules — persistRules", () => {
  it("writes a schema-stamped store under the IDB key", async () => {
    const rules: WatchRule[] = [];
    await persistRules(rules);
    expect(set).toHaveBeenCalledWith(IDB_KEY, { schemaVersion: 1, rules });
  });
});

describe("watcher/rules — buildRule genId fallback", () => {
  it("uses a non-crypto id when crypto.randomUUID is unavailable", () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const r = buildRule({
        workspaceId: "w",
        chainId: 369,
        kind: "address_activity",
        address: "0xaaaa000000000000000000000000000000000001",
      });
      expect(r.id).toMatch(/^wr-/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: orig, configurable: true });
    }
  });
});

describe("watcher/types — ruleLabel erc20 branch", () => {
  it("defaults an erc20_transfer rule to 'Token transfers'", () => {
    const r = buildRule({
      workspaceId: "w",
      chainId: 369,
      kind: "erc20_transfer",
      contractAddress: "0xccc0000000000000000000000000000000000003",
    });
    expect(ruleLabel(r)).toBe("Token transfers");
  });

  it("prefers a user label over the kind default", () => {
    const r = buildRule({
      workspaceId: "w",
      chainId: 369,
      kind: "erc20_transfer",
      contractAddress: "0xccc0000000000000000000000000000000000003",
      label: "  WPLS watch  ",
    });
    expect(ruleLabel(r)).toBe("WPLS watch");
  });
});
