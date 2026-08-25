import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appearanceOutageMessage } from "../../src/services/explorer/addresses/outageMessage.js";

/**
 * The 503 the address page renders verbatim. Its first job is unchanged and
 * non-negotiable: never let an index timeout read as "this address has no
 * transactions". Its second job is newer — promise a useful retry only when a
 * background warm is genuinely running.
 */
describe("appearanceOutageMessage", () => {
  it("always says the index failed, never that the address is empty", () => {
    for (const warming of [true, false]) {
      const message = appearanceOutageMessage(warming);
      assert.match(message, /did not answer/);
      assert.match(message, /not an empty address/);
    }
  });

  it("offers the retry only while a warm is running", () => {
    assert.match(appearanceOutageMessage(true), /Try again/);
    assert.doesNotMatch(appearanceOutageMessage(false), /Try again/);
  });

  it("keeps the message short enough to render in a section card", () => {
    assert.ok(appearanceOutageMessage(true).length < 260);
  });
});
