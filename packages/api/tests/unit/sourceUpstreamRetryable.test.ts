/**
 * The `/api/source` upstream-failure envelope must tell the truth about whether
 * retrying can help.
 *
 * Chain 943 has `sourcifyEnabled: false`, so its Blockscout is the ONLY
 * verified-source provider. That Blockscout's backend
 * (api.scan.v4.testnet.pulsechain.com) 500s on every module/action and on the
 * v2 REST surface, and Sourcify does not index 943 — per the operator
 * (2026-08-05) there are no plans for it to. The route nonetheless answered
 * "Verification source temporarily unavailable … the contract may actually be
 * verified — retry shortly", every clause of which is false there. The client
 * retries anything matching that phrase three times with backoff, which turned
 * ~9 contracts on one debugger page into 63 failed requests.
 *
 * These tests pin the envelope by chain, since the chain config is what decides
 * whether a second opinion exists.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runWithChain } from "../../src/services/chains/context.js";
import { ApiError } from "../../src/lib/respond.js";
import { upstreamUnavailable } from "../../src/routes/source.js";

const PULSECHAIN = 369; // sourcifyEnabled: true  → two providers
const PULSECHAIN_TESTNET = 943; // sourcifyEnabled: false → Blockscout only
const SEPOLIA = 11155111; // sourcifyEnabled: true  → two providers

function build(chainId: number, upstream = "blockscout"): ApiError {
  return runWithChain(chainId, () => upstreamUnavailable(upstream));
}

describe("single-provider chains report a non-retryable outage", () => {
  it("943 is not retryable — there is no second opinion to wait for", () => {
    const err = build(PULSECHAIN_TESTNET);
    assert.equal(err.status, 503);
    assert.equal(err.details?.retryable, false);
  });

  it("says what is actually wrong, and never claims 'retry shortly'", () => {
    const err = build(PULSECHAIN_TESTNET);
    const text = `${err.message} ${String(err.details?.hint)}`;
    assert.doesNotMatch(text, /retry shortly/i);
    assert.doesNotMatch(text, /temporarily/i);
    assert.match(text, /Sourcify does not index this chain/i);
    // Name the chain so the message is actionable in a mixed-chain UI.
    assert.match(text, /PulseChain Testnet v4/);
  });

  it("does NOT match the phrase the client retries on", () => {
    // The client's legacy transient test is /temporarily unavailable/i. Even a
    // client that has not learned the flag yet must stop retrying this.
    const err = build(PULSECHAIN_TESTNET);
    assert.doesNotMatch(err.message, /temporarily unavailable/i);
  });
});

describe("multi-provider chains keep the retryable outage envelope", () => {
  for (const chainId of [PULSECHAIN, SEPOLIA]) {
    it(`${chainId} stays retryable — waiting can genuinely change the answer`, () => {
      const err = build(chainId, "sourcify");
      assert.equal(err.status, 503);
      assert.equal(err.details?.retryable, true);
      assert.match(err.message, /temporarily unavailable/i);
      assert.match(String(err.details?.hint), /retry shortly/i);
    });
  }

  it("names the upstream that failed", () => {
    assert.match(String(build(PULSECHAIN, "sourcify").details?.hint), /sourcify/);
    assert.match(
      String(build(PULSECHAIN, "blockscout").details?.hint),
      /blockscout/,
    );
  });
});

describe("the flag is always present", () => {
  it("every chain sets an explicit boolean, never undefined", () => {
    // The client treats a missing flag as retryable (back-compat). A chain that
    // silently omitted it would quietly re-enable the retry storm.
    for (const chainId of [PULSECHAIN, PULSECHAIN_TESTNET, SEPOLIA, 1]) {
      const value = build(chainId).details?.retryable;
      assert.equal(typeof value, "boolean", `chain ${chainId} omitted retryable`);
    }
  });
});
