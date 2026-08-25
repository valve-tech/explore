import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPrestateUnavailable } from "../../src/services/forkSimulator/prestate.js";

/**
 * The simulator's Diff tab prints "No state changes detected" for an empty
 * diff. That is a real outcome for a view-only call and a lie for a fork
 * that never reported the state before the call — and the diff looks the
 * same either way. The prestate map is what separates them.
 */
describe("isPrestateUnavailable", () => {
  it("is true for an empty map — the tracer never answered", () => {
    assert.equal(isPrestateUnavailable({}), true);
  });

  /**
   * The distinguishing case, and why the empty map is decidable at all: a
   * simulated transaction always spends gas from its sender, so a working
   * prestateTracer always reports at least that one account. "This
   * transaction touched nothing" is not a state the tracer can be in.
   */
  it("is false once any account came back, even with no changes to show", () => {
    const senderOnly = {
      "0x1111111111111111111111111111111111111111": {
        balance: "0x0",
        nonce: 0,
      },
    };
    assert.equal(isPrestateUnavailable(senderOnly), false);
    assert.notEqual(isPrestateUnavailable(senderOnly), isPrestateUnavailable({}));
  });

  it("is false for a multi-account prestate", () => {
    assert.equal(
      isPrestateUnavailable({
        "0x1111111111111111111111111111111111111111": { nonce: 7 },
        "0x2222222222222222222222222222222222222222": { storage: {} },
      }),
      false,
    );
  });
});
