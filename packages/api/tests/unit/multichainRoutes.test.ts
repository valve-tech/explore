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
});
