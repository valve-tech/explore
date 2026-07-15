import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  createBreakerState,
  isCooledDown,
  recordFailure,
  recordSuccess,
  shouldSkip,
} from "../../src/services/sourceCode/breaker.js";

/**
 * The breaker exists because `getVerifiedSource` (correctly) never
 * negative-caches an address when an upstream FAILED rather than answered.
 * With a persistently-dead upstream that means every request re-pays its full
 * connect timeout for every unverified address — ~10.5s each against the
 * unreachable `api.scan.pulsechain.com`, which is what pushed /api/tx past its
 * 15s budget into a 504.
 */

const T0 = 1_000_000;

const openIt = (s: ReturnType<typeof createBreakerState>, at = T0) => {
  for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, at);
};

describe("breaker: closed until the threshold", () => {
  it("starts closed", () => {
    assert.equal(shouldSkip(createBreakerState()), false);
  });

  it("stays closed below the threshold", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) recordFailure(s, T0);
    assert.equal(shouldSkip(s), false, "one failure must not trip a dead-upstream guard");
  });

  it("opens at the threshold", () => {
    const s = createBreakerState();
    openIt(s);
    assert.equal(shouldSkip(s), true);
  });
});

describe("breaker: success resets", () => {
  it("a definitive answer clears accumulated failures", () => {
    const s = createBreakerState();
    recordFailure(s, T0);
    recordSuccess(s);
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) recordFailure(s, T0);
    assert.equal(shouldSkip(s), false, "failures must not accumulate across a success");
  });

  it("a success closes an open circuit", () => {
    const s = createBreakerState();
    openIt(s);
    recordSuccess(s);
    assert.equal(shouldSkip(s), false);
  });
});

describe("breaker: an open circuit never blocks a caller", () => {
  it("keeps skipping even after the cooldown elapses", () => {
    // The whole point: a cooled-down circuit is re-probed in the BACKGROUND.
    // If shouldSkip went false here, one unlucky request per cooldown would
    // pay the dead upstream's full timeout — forever.
    const s = createBreakerState();
    openIt(s);
    assert.equal(shouldSkip(s), true, "before cooldown");
    // shouldSkip is clock-independent by design — the cooldown only decides
    // whether to SCHEDULE a probe (isCooledDown), never whether to let a
    // caller through.
    assert.equal(isCooledDown(s, T0 + BREAKER_COOLDOWN_MS), true, "probe is due");
    assert.equal(
      shouldSkip(s),
      true,
      "after cooldown too — only a probe's result may close the circuit",
    );
  });
});

describe("breaker: cooldown gates the background probe", () => {
  it("does not probe before the cooldown", () => {
    const s = createBreakerState();
    openIt(s);
    assert.equal(isCooledDown(s, T0 + BREAKER_COOLDOWN_MS - 1), false);
  });

  it("probes once the cooldown elapses", () => {
    const s = createBreakerState();
    openIt(s);
    assert.equal(isCooledDown(s, T0 + BREAKER_COOLDOWN_MS), true);
  });

  it("never probes a closed circuit", () => {
    assert.equal(isCooledDown(createBreakerState(), T0 + BREAKER_COOLDOWN_MS), false);
  });

  it("a failed probe restarts the cooldown", () => {
    const s = createBreakerState();
    openIt(s);
    const probeAt = T0 + BREAKER_COOLDOWN_MS;
    assert.equal(isCooledDown(s, probeAt), true);

    recordFailure(s, probeAt); // probe came back dead
    assert.equal(isCooledDown(s, probeAt), false, "cooldown restarts from the probe");
    assert.equal(isCooledDown(s, probeAt + BREAKER_COOLDOWN_MS), true);
  });
});

describe("breaker: failure count is clamped", () => {
  it("does not grow without bound while a circuit stays open", () => {
    const s = createBreakerState();
    for (let i = 0; i < 500; i++) recordFailure(s, T0);
    assert.equal(s.failures, BREAKER_THRESHOLD, "clamped at the threshold");
    // And a single success still fully closes it.
    recordSuccess(s);
    assert.equal(shouldSkip(s), false);
  });
});
