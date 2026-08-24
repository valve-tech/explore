import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChainsParam } from "../../src/routes/multichain/schemas.js";

/**
 * The `chains` allowlist carries the UI's testnet toggle to the server. Getting
 * it wrong is expensive in both directions: too permissive and the fan-out
 * costs RPC budget the user asked us not to spend; too lenient about bad input
 * and a typo silently narrows the answer.
 */

describe("parseChainsParam", () => {
  it("returns undefined when the parameter is absent or empty", () => {
    assert.equal(parseChainsParam(undefined), undefined);
    assert.equal(parseChainsParam(""), undefined);
  });

  it("parses a comma-separated list into ascending unique ids", () => {
    assert.deepEqual(parseChainsParam("369,1,1"), [1, 369]);
  });

  it("tolerates whitespace around ids", () => {
    assert.deepEqual(parseChainsParam(" 1 , 369 "), [1, 369]);
  });

  it("throws on an unregistered chain rather than dropping it", () => {
    assert.throws(() => parseChainsParam("1,8453"), /8453/);
  });

  it("throws on a non-numeric entry", () => {
    assert.throws(() => parseChainsParam("1,abc"), /abc/);
  });

  it("throws on a non-decimal spelling of a chain id (parser differential)", () => {
    // Number() accepts far more than decimal digits — hex, octal, binary,
    // scientific notation, a leading "+", a trailing ".0" — all of which
    // Number("0x1") etc. coerce to a valid chain id today. Each of these is a
    // different SPELLING of the same value; accepting all of them means any
    // other code that reads the raw query string (an access log, a rate
    // limiter, a future cache key) can disagree with what this parser saw.
    // One spelling per chain id: decimal digits only.
    assert.throws(() => parseChainsParam("0x1"), /Invalid chain id: 0x1/);
    assert.throws(() => parseChainsParam("1.0"), /Invalid chain id: 1\.0/);
    assert.throws(() => parseChainsParam("+1"), /Invalid chain id: \+1/);
    assert.throws(() => parseChainsParam("1e0"), /Invalid chain id: 1e0/);
  });

  it("throws on a repeated parameter instead of widening to every chain", () => {
    // Express parses `?chains=1&chains=369` into a string array, not the
    // comma-joined form. Falling back to undefined here would silently widen
    // the fan-out — the one thing this parser must never do.
    assert.throws(() => parseChainsParam(["1", "369"]), /repeated parameter/);
  });
});
