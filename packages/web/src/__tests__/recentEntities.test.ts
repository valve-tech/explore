import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * Recently-viewed + pinned entity store. The module keeps state at module scope
 * (initialized from localStorage at import), so the load() path is tested via
 * vi.resetModules() + a fresh dynamic import with localStorage pre-seeded.
 */

type Mod = typeof import("../lib/recentEntities");

async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("../lib/recentEntities");
}

const STORAGE_KEY = "explorer.recentEntities";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recentEntities — load() at import", () => {
  it("starts empty when nothing is stored", async () => {
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores a non-array stored blob", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores invalid JSON (catch path)", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("filters out entries failing the type guard, keeps valid ones, pins first", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        "bad",
        { kind: "tx", value: "0xAA", pinned: 1, visits: 1, lastSeen: 1 }, // pinned not boolean
        { kind: "tx", value: "0xaa", pinned: false, visits: 2, lastSeen: 10 },
        { kind: "address", value: "0xbb", pinned: true, visits: 1, lastSeen: 5 },
      ]),
    );
    const m = await freshModule();
    const snap = m.getSnapshot();
    expect(snap).toHaveLength(2);
    // sorted: pinned address first, then the recent tx
    expect(snap[0]!.pinned).toBe(true);
    expect(snap[0]!.value).toBe("0xbb");
    expect(snap[1]!.value).toBe("0xaa");
  });
});

describe("recentEntities — recordVisit", () => {
  it("creates a fresh entry, canonicalizing 0x values to lower-case", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "address", value: "0xAbCdEf", label: "Vault" });
    const snap = m.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.value).toBe("0xabcdef");
    expect(snap[0]!.label).toBe("Vault");
    expect(snap[0]!.visits).toBe(1);
    expect(snap[0]!.pinned).toBe(false);
  });

  it("keeps non-0x block values verbatim", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "block", value: "26804492" });
    expect(m.getSnapshot()[0]!.value).toBe("26804492");
  });

  it("bumps an existing entry's visit count and merges label/status", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xAA" });
    m.recordVisit({ kind: "tx", value: "0xaa", label: "swap", status: "success" });
    const snap = m.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.visits).toBe(2);
    expect(snap[0]!.label).toBe("swap");
    expect(snap[0]!.status).toBe("success");
  });

  it("keeps contract and address apart even at the same 0x value", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "address", value: "0xaa" });
    m.recordVisit({ kind: "contract", value: "0xaa" });
    expect(m.getSnapshot()).toHaveLength(2);
  });

  it("evicts the oldest unpinned entry beyond the 24-cap, keeping pins", async () => {
    const m = await freshModule();
    // Pin one entry first (it must survive eviction).
    m.recordVisit({ kind: "address", value: "0xpinned" });
    m.togglePin("address", "0xpinned");

    let t = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1000));
    for (let i = 0; i < 30; i++) {
      m.recordVisit({ kind: "tx", value: `0x${i.toString(16).padStart(40, "0")}` });
    }
    const snap = m.getSnapshot();
    const unpinned = snap.filter((e) => !e.pinned);
    expect(unpinned).toHaveLength(24); // capped
    expect(snap.some((e) => e.value === "0xpinned" && e.pinned)).toBe(true);
    // oldest unpinned (tx index 0) was evicted
    expect(snap.some((e) => e.value === `0x${(0).toString(16).padStart(40, "0")}`)).toBe(
      false,
    );
    vi.restoreAllMocks();
  });

  it("persists to localStorage on commit", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe("0xaa");
  });

  it("survives a localStorage.setItem failure (best-effort persistence)", async () => {
    const m = await freshModule();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => m.recordVisit({ kind: "tx", value: "0xaa" })).not.toThrow();
    expect(m.getSnapshot()).toHaveLength(1); // in-memory state still updated
    spy.mockRestore();
  });
});

describe("recentEntities — enrichEntity", () => {
  it("no-ops when the entity isn't present", async () => {
    const m = await freshModule();
    m.enrichEntity("tx", "0xmissing", { label: "x" });
    expect(m.getSnapshot()).toEqual([]);
  });

  it("no-ops (no re-render) when nothing changed", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa", label: "swap", status: "success" });
    const before = m.getSnapshot();
    m.enrichEntity("tx", "0xAA", { label: "swap", status: "success" });
    expect(m.getSnapshot()).toBe(before); // same reference — no commit
  });

  it("merges label/status without bumping visits", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa" });
    m.enrichEntity("tx", "0xAA", { label: "named", status: "reverted" });
    const e = m.getSnapshot()[0]!;
    expect(e.label).toBe("named");
    expect(e.status).toBe("reverted");
    expect(e.visits).toBe(1);
  });
});

describe("recentEntities — togglePin / removeEntity / clearRecent", () => {
  it("toggles pin state", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa" });
    m.togglePin("tx", "0xaa");
    expect(m.getSnapshot()[0]!.pinned).toBe(true);
    m.togglePin("tx", "0xaa");
    expect(m.getSnapshot()[0]!.pinned).toBe(false);
  });

  it("removes a single entity by (kind, value)", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa" });
    m.recordVisit({ kind: "address", value: "0xbb" });
    m.removeEntity("tx", "0xaa");
    expect(m.getSnapshot().map((e) => e.value)).toEqual(["0xbb"]);
  });

  it("clearRecent drops unpinned, keeps pinned", async () => {
    const m = await freshModule();
    m.recordVisit({ kind: "tx", value: "0xaa" });
    m.recordVisit({ kind: "address", value: "0xbb" });
    m.togglePin("address", "0xbb");
    m.clearRecent();
    const snap = m.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.value).toBe("0xbb");
  });
});

describe("recentEntities — subscribe", () => {
  it("notifies subscribers on mutation and stops after unsubscribe", async () => {
    const m = await freshModule();
    const fn = vi.fn();
    const unsub = m.subscribe(fn);
    m.recordVisit({ kind: "tx", value: "0xaa" });
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    m.recordVisit({ kind: "tx", value: "0xbb" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
