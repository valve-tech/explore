import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Supplements recentDebuggerTxs.test.ts — covers the load() parsing branches
 * (run at module import, so via vi.resetModules + dynamic import) and subscribe.
 */

type Mod = typeof import("../lib/recentDebuggerTxs");

async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("../lib/recentDebuggerTxs");
}

const STORAGE_KEY = "debugger.recentTxs";

beforeEach(() => {
  localStorage.clear();
});

describe("recentDebuggerTxs — load() at import", () => {
  it("hydrates valid entries from localStorage", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ hash: "0xseed", lastSeen: 5 }]),
    );
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([{ hash: "0xseed", lastSeen: 5 }]);
  });

  it("returns empty when nothing is stored", async () => {
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores a non-array blob", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nope: 1 }));
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores invalid JSON (catch path)", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("filters out malformed entries", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        "bad",
        { hash: 1, lastSeen: 2 }, // hash not string
        { hash: "0xa", lastSeen: "x" }, // lastSeen not number
        { hash: "0xok", lastSeen: 9 }, // valid
      ]),
    );
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([{ hash: "0xok", lastSeen: 9 }]);
  });
});

describe("recentDebuggerTxs — subscribe + write failure", () => {
  it("notifies on record and stops after unsubscribe", async () => {
    const m = await freshModule();
    const fn = vi.fn();
    const unsub = m.subscribe(fn);
    m.recordDebuggerTx("0xaaa");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    m.recordDebuggerTx("0xbbb");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("survives a localStorage write failure (best-effort)", async () => {
    const m = await freshModule();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => m.recordDebuggerTx("0xaaa")).not.toThrow();
    expect(m.getSnapshot().map((t) => t.hash)).toEqual(["0xaaa"]);
    spy.mockRestore();
  });
});
