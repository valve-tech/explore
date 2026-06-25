import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * Tracked-transaction store. State is module-scoped (loaded from localStorage at
 * import), so the load() path is exercised via vi.resetModules() + a fresh
 * dynamic import with localStorage pre-seeded.
 */

type Mod = typeof import("../lib/trackedTxs");

async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("../lib/trackedTxs");
}

const STORAGE_KEY = "explorer.trackedTxs";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trackedTxs — load() at import", () => {
  it("starts empty with nothing stored", async () => {
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores a non-array blob", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nope: true }));
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("ignores invalid JSON (catch path)", async () => {
    localStorage.setItem(STORAGE_KEY, "not json{");
    const m = await freshModule();
    expect(m.getSnapshot()).toEqual([]);
  });

  it("filters out entries failing the type guard", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        null,
        "bad",
        { hash: 123, firstSeen: 1, status: "pending" }, // hash not string
        { hash: "0xa", firstSeen: "x", status: "pending" }, // firstSeen not number
        { hash: "0xb", firstSeen: 1, status: "weird" }, // bad status
        { hash: "0xc", firstSeen: 1, status: "mined" }, // valid
      ]),
    );
    const m = await freshModule();
    const snap = m.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.hash).toBe("0xc");
  });
});

describe("trackedTxs — track / untrack / toggle", () => {
  it("tracks a tx as pending, newest first", async () => {
    const m = await freshModule();
    m.trackTx("0xaaa");
    m.trackTx("0xbbb");
    const snap = m.getSnapshot();
    expect(snap.map((t) => t.hash)).toEqual(["0xbbb", "0xaaa"]);
    expect(snap[0]!.status).toBe("pending");
  });

  it("trackTx is idempotent (case-insensitive)", async () => {
    const m = await freshModule();
    m.trackTx("0xAaA");
    m.trackTx("0xaaa");
    expect(m.getSnapshot()).toHaveLength(1);
  });

  it("isTracked is case-insensitive", async () => {
    const m = await freshModule();
    m.trackTx("0xAbC");
    expect(m.isTracked("0xabc")).toBe(true);
    expect(m.isTracked("0xABC")).toBe(true);
    expect(m.isTracked("0xdef")).toBe(false);
  });

  it("untrackTx removes by hash (case-insensitive)", async () => {
    const m = await freshModule();
    m.trackTx("0xAaA");
    m.untrackTx("0xaaa");
    expect(m.getSnapshot()).toEqual([]);
  });

  it("toggleTrack adds then removes", async () => {
    const m = await freshModule();
    m.toggleTrack("0xaaa");
    expect(m.isTracked("0xaaa")).toBe(true);
    m.toggleTrack("0xAAA");
    expect(m.isTracked("0xaaa")).toBe(false);
  });

  it("persists to localStorage and survives a write failure", async () => {
    const m = await freshModule();
    m.trackTx("0xaaa");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => m.trackTx("0xbbb")).not.toThrow();
    expect(m.getSnapshot()).toHaveLength(2);
    spy.mockRestore();
  });
});

describe("trackedTxs — resolveTracked", () => {
  it("no-ops when the tx isn't tracked", async () => {
    const m = await freshModule();
    m.resolveTracked("0xmissing", { status: "mined" });
    expect(m.getSnapshot()).toEqual([]);
  });

  it("stamps resolvedAt the first time it leaves pending and freezes it", async () => {
    const m = await freshModule();
    let t = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 1_000));
    m.trackTx("0xaaa"); // firstSeen stamp
    m.resolveTracked("0xaaa", {
      status: "mined",
      blockNumber: "26804492",
      execStatus: "success",
    });
    const first = m.getSnapshot()[0]!;
    expect(first.status).toBe("mined");
    expect(first.execStatus).toBe("success");
    expect(first.blockNumber).toBe("26804492");
    const frozen = first.resolvedAt;
    expect(frozen).toBeDefined();

    // A later resolution keeps the original resolvedAt (frozen timer).
    m.resolveTracked("0xaaa", { status: "dropped" });
    expect(m.getSnapshot()[0]!.resolvedAt).toBe(frozen);
    vi.restoreAllMocks();
  });

  it("is idempotent — same patch returns same reference (no commit)", async () => {
    const m = await freshModule();
    m.trackTx("0xaaa");
    m.resolveTracked("0xaaa", { status: "mined", blockNumber: "5", execStatus: "success" });
    const before = m.getSnapshot();
    m.resolveTracked("0xaaa", { status: "mined", blockNumber: "5", execStatus: "success" });
    expect(m.getSnapshot()).toBe(before);
  });

  it("keeps existing blockNumber/execStatus when patch omits them", async () => {
    const m = await freshModule();
    m.trackTx("0xaaa");
    m.resolveTracked("0xaaa", { status: "mined", blockNumber: "9", execStatus: "reverted" });
    // Re-resolve with only a status change; prior fields persist.
    m.resolveTracked("0xaaa", { status: "dropped" });
    const t = m.getSnapshot()[0]!;
    expect(t.status).toBe("dropped");
    expect(t.blockNumber).toBe("9");
    expect(t.execStatus).toBe("reverted");
  });
});

describe("trackedTxs — clearResolved", () => {
  it("keeps pending, drops mined/dropped", async () => {
    const m = await freshModule();
    m.trackTx("0xpend");
    m.trackTx("0xmine");
    m.resolveTracked("0xmine", { status: "mined" });
    m.clearResolved();
    expect(m.getSnapshot().map((t) => t.hash)).toEqual(["0xpend"]);
  });
});

describe("trackedTxs — subscribe", () => {
  it("fires on mutation and stops after unsubscribe", async () => {
    const m = await freshModule();
    const fn = vi.fn();
    const unsub = m.subscribe(fn);
    m.trackTx("0xaaa");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    m.trackTx("0xbbb");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
