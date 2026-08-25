import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleIndexWarm,
  isWarming,
  isWarmHopeless,
  isIndexTimeout,
  _resetIndexWarms,
  WARM_COOLDOWN_MS,
  MAX_CONCURRENT_WARMS,
  HOPELESS_AFTER_FAILURES,
} from "../../src/services/chifra/warmIndex.js";

/**
 * The gate that keeps the warm honest. A warm is only useful when the read ran
 * out of time; if chifra is unreachable, a longer read fails identically and
 * the address page must not promise a retry that cannot work.
 */
describe("isIndexTimeout", () => {
  /** How the SDK reports our own `AbortSignal.timeout` firing. */
  const wrapped = (cause: unknown) => Object.assign(new Error("chifra"), { cause });

  it("is true for our own deadline, under either DOMException name", () => {
    assert.equal(isIndexTimeout(wrapped({ name: "TimeoutError" })), true);
    assert.equal(isIndexTimeout(wrapped({ name: "AbortError" })), true);
  });

  it("is true for a gateway timeout — Cloudflare's 524 in front of chifra", () => {
    assert.equal(isIndexTimeout({ status: 524 }), true);
    assert.equal(isIndexTimeout({ status: 504 }), true);
    assert.equal(isIndexTimeout({ status: 502 }), true);
  });

  it("is false when the daemon answered with a real error", () => {
    assert.equal(isIndexTimeout({ status: 500 }), false);
    assert.equal(isIndexTimeout({ status: 404 }), false);
    assert.equal(isIndexTimeout({ status: 400 }), false);
  });

  it("is false when the connection never opened", () => {
    assert.equal(isIndexTimeout(wrapped(new TypeError("fetch failed"))), false);
    assert.equal(isIndexTimeout(new Error("boom")), false);
    assert.equal(isIndexTimeout(null), false);
    assert.equal(isIndexTimeout(undefined), false);
  });

  /** A status, when present, decides on its own — it is the stronger signal. */
  it("prefers the status over the cause", () => {
    assert.equal(
      isIndexTimeout({ status: 500, cause: { name: "TimeoutError" } }),
      false,
    );
  });
});

/**
 * The warm exists because a cold index read on a heavy address costs more than
 * one request may wait. Its whole job is to run ONE long read per address and
 * get out of the way, so every test here is about restraint: no duplicates, no
 * pile-up, no re-running an address we just did.
 */
describe("scheduleIndexWarm", () => {
  beforeEach(() => {
    _resetIndexWarms();
  });

  /** A warm that never settles, so the caller stays "in flight". */
  const pending = () => new Promise<unknown>(() => {});

  it("starts one background read and reports the address as warming", () => {
    const outcome = scheduleIndexWarm("pulsechain", "0xAbC", {
      run: pending,
      now: () => 0,
    });
    assert.equal(outcome, "started");
    assert.equal(isWarming("pulsechain", "0xabc"), true);
  });

  it("does not start a second warm for an address already warming", () => {
    let runs = 0;
    const deps = {
      run: () => {
        runs += 1;
        return pending();
      },
      now: () => 0,
    };
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
    assert.equal(scheduleIndexWarm("pulsechain", "0xabc", deps), "in-flight");
    assert.equal(runs, 1);
  });

  /**
   * Chain scoping is a correctness property here as everywhere: the same
   * address on two chains is two different monitors and two different reads.
   */
  it("keys the warm by chain as well as address", () => {
    const deps = { run: pending, now: () => 0 };
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
    assert.equal(scheduleIndexWarm("mainnet", "0xAbC", deps), "started");
    assert.equal(isWarming("mainnet", "0xabc"), true);
  });

  it("stops warming once the read settles, and then cools down", async () => {
    let clock = 0;
    const deps = { run: () => Promise.resolve("done"), now: () => clock };
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(isWarming("pulsechain", "0xabc"), false);
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "cooling");
    clock = WARM_COOLDOWN_MS + 1;
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
  });

  /**
   * A failed warm must clear its slot too. It is the likelier outcome — the
   * biggest monitors time out at Cloudflare's ~100s origin cut — and a leaked
   * slot would block that address forever.
   */
  it("clears the slot when the read rejects", async () => {
    const deps = {
      run: () => Promise.reject(new Error("524")),
      now: () => 0,
    };
    assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(isWarming("pulsechain", "0xabc"), false);
  });

  /**
   * Some addresses never converge — WPLS on chain 369 failed three
   * consecutive ~125s reads. After enough failures the page must stop telling
   * its reader to try again.
   */
  it("gives up on an address that keeps failing", async () => {
    let clock = 0;
    const deps = {
      run: () => Promise.reject(new Error("524")),
      now: () => clock,
    };
    for (let i = 0; i < HOPELESS_AFTER_FAILURES; i += 1) {
      assert.equal(isWarmHopeless("pulsechain", "0xAbC"), false);
      assert.equal(scheduleIndexWarm("pulsechain", "0xAbC", deps), "started");
      await Promise.resolve();
      await Promise.resolve();
      clock += WARM_COOLDOWN_MS + 1;
    }
    assert.equal(isWarmHopeless("pulsechain", "0xabc"), true);
  });

  it("forgets the failures as soon as one warm succeeds", async () => {
    let clock = 0;
    let fail = true;
    const deps = {
      run: () => (fail ? Promise.reject(new Error("524")) : Promise.resolve(1)),
      now: () => clock,
    };
    for (let i = 0; i < HOPELESS_AFTER_FAILURES; i += 1) {
      scheduleIndexWarm("pulsechain", "0xAbC", deps);
      await Promise.resolve();
      await Promise.resolve();
      clock += WARM_COOLDOWN_MS + 1;
    }
    assert.equal(isWarmHopeless("pulsechain", "0xabc"), true);
    fail = false;
    scheduleIndexWarm("pulsechain", "0xAbC", deps);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(isWarmHopeless("pulsechain", "0xabc"), false);
  });

  it("refuses to pile up more warms than the cap", () => {
    const deps = { run: pending, now: () => 0 };
    for (let i = 0; i < MAX_CONCURRENT_WARMS; i += 1) {
      assert.equal(scheduleIndexWarm("pulsechain", `0x${i}`, deps), "started");
    }
    assert.equal(scheduleIndexWarm("pulsechain", "0xlate", deps), "at-capacity");
    assert.equal(isWarming("pulsechain", "0xlate"), false);
  });

  /**
   * The caller is already on an error path. A warm that threw would turn a
   * truthful 503 into a 500.
   */
  it("never throws when the read throws synchronously", () => {
    assert.doesNotThrow(() =>
      scheduleIndexWarm("pulsechain", "0xAbC", {
        run: () => Promise.reject(new Error("boom")),
        now: () => 0,
      }),
    );
  });
});
