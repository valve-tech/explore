import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ChainHealthCache } from "../../../src/services/networkHealth/cache.js";
import {
  POSITION_BUCKETS,
  type BlockMetrics,
} from "../../../src/services/networkHealth/types.js";

/** A minimal valid BlockMetrics — the cache only reads `.number`. */
function metrics(n: bigint): BlockMetrics {
  const zero = { legacy: 0n, modern: 0n };
  return {
    number: n,
    timestamp: Number(n),
    miner: "0xminer",
    baseFeePerGas: 0n,
    gasUsed: 0n,
    gasLimit: 0n,
    txCount: 0,
    gasByType: { ...zero },
    countByType: { legacy: 0, modern: 0 },
    burnedByType: { ...zero },
    tipsByType: { ...zero },
    paidByType: { ...zero },
    posBpsGasByType: { ...zero },
    posHistGasByType: {
      legacy: new Array<bigint>(POSITION_BUCKETS).fill(0n),
      modern: new Array<bigint>(POSITION_BUCKETS).fill(0n),
    },
    tipAscent: 0n,
    tipVariation: 0n,
    overPrioritizedGasByType: { ...zero },
  };
}

/** Fake fetcher harness — records fetched numbers and a movable head + clock. */
function harness(initialHead: bigint) {
  const fetched: bigint[] = [];
  const state = { head: initialHead, now: 0 };
  const cache = new ChainHealthCache({
    getHead: () => Promise.resolve(state.head),
    fetchBlock: (n) => {
      fetched.push(n);
      return Promise.resolve(metrics(n));
    },
    cap: 10,
    initialWindow: 5,
    loadChunk: 5,
    headTtlMs: 1000,
    concurrency: 4,
    now: () => state.now,
  });
  return { cache, fetched, state };
}

describe("ChainHealthCache — warm", () => {
  it("cold warm pulls the latest initialWindow blocks", async () => {
    const { cache } = harness(100n);
    await cache.ensureFresh();
    assert.equal(cache.size(), 5);
    assert.equal(cache.head(), 100n);
    const win = cache.getWindow(101n, 5).map((m) => m.number);
    assert.deepEqual(win, [100n, 99n, 98n, 97n, 96n]); // newest-first
  });
});

describe("ChainHealthCache — head top-up", () => {
  it("is throttled by headTtlMs, then backfills the gap", async () => {
    const { cache, state } = harness(100n);
    await cache.ensureFresh(); // 96..100
    // within TTL: no new fetch even though head moved
    state.head = 102n;
    state.now = 500;
    await cache.ensureFresh();
    assert.equal(cache.head(), 100n);
    // past TTL: backfill 101..102
    state.now = 1500;
    await cache.ensureFresh();
    assert.equal(cache.head(), 102n);
    assert.equal(cache.size(), 7);
  });

  it("evicts the oldest beyond the cap as the head advances", async () => {
    const { cache, state } = harness(100n);
    await cache.ensureFresh(); // 96..100 (5)
    state.head = 105n;
    state.now = 2000;
    await cache.ensureFresh(); // +101..105 → 10
    assert.equal(cache.size(), 10);
    state.head = 110n;
    state.now = 4000;
    await cache.ensureFresh(); // +106..110 → 15, evict to cap 10 → 101..110
    assert.equal(cache.size(), 10);
    assert.equal(cache.head(), 110n);
    const win = cache.getWindow(111n, 100).map((m) => m.number);
    assert.equal(win[win.length - 1], 101n); // oldest retained
  });

  it("resets to the latest window when the gap exceeds initialWindow", async () => {
    const { cache, state } = harness(100n);
    await cache.ensureFresh(); // 96..100
    state.head = 200n; // gap 100 ≫ initialWindow 5
    state.now = 2000;
    await cache.ensureFresh();
    assert.equal(cache.size(), 5);
    assert.equal(cache.head(), 200n);
    const win = cache.getWindow(201n, 5).map((m) => m.number);
    assert.deepEqual(win, [200n, 199n, 198n, 197n, 196n]);
  });
});

describe("ChainHealthCache — load more", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    h = harness(100n);
    await h.cache.ensureFresh(); // 96..100
  });

  it("loads older chunks to satisfy a window below the cached range", async () => {
    const { cache } = h;
    // before=96 → nothing cached below it yet
    await cache.ensureBelow(96n, 5);
    const win = cache.getWindow(96n, 5).map((m) => m.number);
    assert.deepEqual(win, [95n, 94n, 93n, 92n, 91n]);
  });

  it("stops loading at the cap", async () => {
    const { cache } = h; // cap 10, already 5 cached
    await cache.ensureBelow(96n, 100); // wants more than the cap allows
    assert.equal(cache.size(), 10);
  });

  it("hasMore is false at genesis floor", async () => {
    const g = harness(3n);
    await g.cache.ensureFresh(); // 0..3 (head 3, initialWindow 5 clamps at 0)
    assert.equal(g.cache.size(), 4);
    const oldest = g.cache.getWindow(4n, 100).at(-1)?.number ?? null;
    assert.equal(g.cache.hasMore(oldest), false);
  });
});
