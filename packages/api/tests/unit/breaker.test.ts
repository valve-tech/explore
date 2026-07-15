import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BREAKER_COOLDOWN_MS,
  BREAKER_THRESHOLD,
  createBreakerState,
  halfOpen,
  isOpen,
  recordFailure,
  recordSuccess,
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

describe("breaker: closed until the threshold", () => {
  it("starts closed", () => {
    assert.equal(isOpen(createBreakerState(), T0), false);
  });

  it("stays closed below the threshold", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) recordFailure(s, T0);
    assert.equal(isOpen(s, T0), false, "one failure must not trip a dead-upstream guard");
  });

  it("opens at the threshold", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);
    assert.equal(isOpen(s, T0), true);
  });
});

describe("breaker: success resets", () => {
  it("a definitive answer clears accumulated failures", () => {
    const s = createBreakerState();
    recordFailure(s, T0);
    recordSuccess(s);
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) recordFailure(s, T0);
    assert.equal(isOpen(s, T0), false, "failures must not accumulate across a success");
  });

  it("a success closes an open circuit", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);
    recordSuccess(s);
    assert.equal(isOpen(s, T0), false);
  });
});

describe("breaker: cooldown", () => {
  it("stays open for the cooldown", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);
    assert.equal(isOpen(s, T0 + BREAKER_COOLDOWN_MS - 1), true);
  });

  it("closes once the cooldown elapses, so a recovered upstream is re-probed", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);
    assert.equal(isOpen(s, T0 + BREAKER_COOLDOWN_MS), false);
  });
});

describe("breaker: half-open probe", () => {
  it("a single failure re-opens immediately after a probe is let through", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);

    const later = T0 + BREAKER_COOLDOWN_MS;
    assert.equal(isOpen(s, later), false, "cooled down → probe allowed");
    halfOpen(s);

    // The probe fails: a still-dead upstream must not get another full
    // threshold's worth of timeouts before re-opening.
    recordFailure(s, later);
    assert.equal(isOpen(s, later), true, "one failed probe must re-open the circuit");
  });

  it("a successful probe fully closes the circuit", () => {
    const s = createBreakerState();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) recordFailure(s, T0);
    const later = T0 + BREAKER_COOLDOWN_MS;
    halfOpen(s);
    recordSuccess(s);

    // Back to a clean slate: one later failure must not re-open.
    recordFailure(s, later);
    assert.equal(isOpen(s, later), false);
  });
});
