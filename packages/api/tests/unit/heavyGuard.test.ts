import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isKnownHeavy,
  noteIndexTimeout,
  clearIndexTimeout,
  acquireReadSlot,
  releaseReadSlot,
  inFlightReads,
  heavyReadSkipped,
  guardedIndexRead,
  _resetHeavyGuard,
  HEAVY_COOLDOWN_MS,
  MAX_CONCURRENT_INDEX_READS,
} from "../../src/services/chifra/heavyGuard.js";
import { isIndexTimeout } from "../../src/services/chifra/warmIndex.js";

const CHAIN = "pulsechain";
const WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27";

beforeEach(() => _resetHeavyGuard());

/**
 * The guard exists because a repeat read does not coalesce with the one
 * already running — it adds another whole-monitor load to the daemon's heap.
 */
describe("isKnownHeavy", () => {
  it("is false for an address that has never timed out", () => {
    assert.equal(isKnownHeavy(CHAIN, WPLS), false);
  });

  it("is true right after a timeout", () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000), true);
  });

  it("matches an address whatever case it arrives in", () => {
    noteIndexTimeout(CHAIN, WPLS.toLowerCase(), 1_000);
    assert.equal(isKnownHeavy(CHAIN, WPLS.toUpperCase(), 1_000), true);
  });

  it("scopes by chain — the same address is cheap on another chain", () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    assert.equal(isKnownHeavy("mainnet", WPLS, 1_000), false);
  });

  it("still holds one millisecond before the cooldown lapses", () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000 + HEAVY_COOLDOWN_MS - 1), true);
  });

  it("lapses exactly at the cooldown, so a heavy address is retryable", () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000 + HEAVY_COOLDOWN_MS), false);
  });

  it("forgets an address whose read later succeeded", () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    clearIndexTimeout(CHAIN, WPLS);
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000), false);
  });

  it("does not grow without bound", () => {
    for (let i = 0; i < 600; i += 1) {
      noteIndexTimeout(CHAIN, `0x${i.toString(16).padStart(40, "0")}`, 1_000);
    }
    // The newest entry survives; the map is capped rather than unbounded.
    assert.equal(
      isKnownHeavy(CHAIN, `0x${(599).toString(16).padStart(40, "0")}`, 1_000),
      true,
    );
  });
});

/**
 * The backstop for the case the per-address memory cannot see: many DIFFERENT
 * heavy addresses, each read only once.
 */
describe("read slots", () => {
  it("hands out exactly MAX_CONCURRENT_INDEX_READS slots", () => {
    for (let i = 0; i < MAX_CONCURRENT_INDEX_READS; i += 1) {
      assert.equal(acquireReadSlot(), true, `slot ${i} should be free`);
    }
    assert.equal(acquireReadSlot(), false);
    assert.equal(inFlightReads(), MAX_CONCURRENT_INDEX_READS);
  });

  it("frees a slot on release", () => {
    for (let i = 0; i < MAX_CONCURRENT_INDEX_READS; i += 1) acquireReadSlot();
    releaseReadSlot();
    assert.equal(acquireReadSlot(), true);
  });

  it("never drops below zero, so an extra release cannot mint slots", () => {
    releaseReadSlot();
    releaseReadSlot();
    assert.equal(inFlightReads(), 0);
    for (let i = 0; i < MAX_CONCURRENT_INDEX_READS; i += 1) {
      assert.equal(acquireReadSlot(), true);
    }
    assert.equal(acquireReadSlot(), false);
  });
});

/**
 * The whole point of the 504 shape: every existing failure path already knows
 * what to do with it, so short-circuiting changes what we spend, not what the
 * reader sees.
 */
describe("heavyReadSkipped", () => {
  it("is recognised as a timeout, so it still schedules a warm and a 503", () => {
    assert.equal(isIndexTimeout(heavyReadSkipped("known-heavy")), true);
    assert.equal(isIndexTimeout(heavyReadSkipped("at-capacity")), true);
  });

  it("records which guard fired, for logs", () => {
    assert.equal(
      (heavyReadSkipped("at-capacity") as { skippedBy?: string }).skippedBy,
      "at-capacity",
    );
  });
});

/**
 * The composition is where a leak would hide: a slot taken on a path that
 * never reaches its `finally` would shrink the pool by one on every refused
 * read until nothing could be read at all.
 */
describe("guardedIndexRead", () => {
  const timeout = () => Object.assign(new Error("gateway"), { status: 504 });
  const isTimeout = (e: unknown) =>
    (e as { status?: number } | null)?.status === 504;

  it("runs the read and returns its value", async () => {
    const value = await guardedIndexRead(
      CHAIN,
      WPLS,
      async () => "rows",
      isTimeout,
    );
    assert.equal(value, "rows");
    assert.equal(inFlightReads(), 0);
  });

  it("marks the address heavy when the read times out", async () => {
    await assert.rejects(
      guardedIndexRead(CHAIN, WPLS, () => Promise.reject(timeout()), isTimeout, () => 1_000),
    );
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000), true);
  });

  it("leaves the address alone when the read fails some other way", async () => {
    await assert.rejects(
      guardedIndexRead(
        CHAIN,
        WPLS,
        () => Promise.reject(new Error("connection refused")),
        isTimeout,
        () => 1_000,
      ),
    );
    assert.equal(isKnownHeavy(CHAIN, WPLS, 1_000), false);
  });

  it("does not call chifra again for a known-heavy address", async () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    let called = 0;
    await assert.rejects(
      guardedIndexRead(
        CHAIN,
        WPLS,
        async () => {
          called += 1;
          return "rows";
        },
        isTimeout,
        () => 1_000,
      ),
      /already being read/,
    );
    assert.equal(called, 0, "the read must not run");
  });

  it("does not consume a slot when it short-circuits", async () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    for (let i = 0; i < 20; i += 1) {
      await assert.rejects(
        guardedIndexRead(CHAIN, WPLS, async () => "x", isTimeout, () => 1_000),
      );
    }
    assert.equal(inFlightReads(), 0, "refused reads must not leak slots");
  });

  it("releases its slot whether the read resolves or rejects", async () => {
    await guardedIndexRead(CHAIN, "0xaaa", async () => "ok", isTimeout);
    await assert.rejects(
      guardedIndexRead(CHAIN, "0xbbb", () => Promise.reject(timeout()), isTimeout),
    );
    assert.equal(inFlightReads(), 0);
  });

  it("refuses once every slot is busy, without running the read", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const running = Array.from({ length: MAX_CONCURRENT_INDEX_READS }, (_, i) =>
      guardedIndexRead(CHAIN, `0x${i}`, async () => {
        await blocked;
        return "ok";
      }, isTimeout),
    );

    let called = 0;
    await assert.rejects(
      guardedIndexRead(
        CHAIN,
        "0xlate",
        async () => {
          called += 1;
          return "ok";
        },
        isTimeout,
      ),
      /Too many appearance index reads/,
    );
    assert.equal(called, 0);

    release();
    await Promise.all(running);
    assert.equal(inFlightReads(), 0);
  });

  it("forgets a heavy address once a later read succeeds", async () => {
    noteIndexTimeout(CHAIN, WPLS, 1_000);
    // Past the cooldown the guard lets one through; that read proves it fine.
    const at = 1_000 + HEAVY_COOLDOWN_MS;
    await guardedIndexRead(CHAIN, WPLS, async () => "rows", isTimeout, () => at);
    assert.equal(isKnownHeavy(CHAIN, WPLS, at), false);
  });
});
