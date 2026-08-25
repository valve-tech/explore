import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAppearanceOutage } from "../../src/services/chifra/appearances.js";

/**
 * Pins the one test that separates "the index is down" from "this address has
 * never been used". Getting it backwards is not a cosmetic bug: before
 * 2026-08-25 the address page told readers that WPLS on chain 369 — one of the
 * busiest contracts on that chain — had no transactions, because chifra hit
 * its 30s cap and the empty result was served as a success.
 */
describe("isAppearanceOutage", () => {
  it("is true for an empty page with no count — the index never answered", () => {
    assert.equal(isAppearanceOutage(0, null), true);
  });

  it("is false for an empty page with a real zero — a genuinely unused address", () => {
    assert.equal(isAppearanceOutage(0, 0), false);
  });

  /**
   * The distinguishing case. Both return an empty page; only the count says
   * which is which. A test that checked just the page length would pass while
   * the product lied.
   */
  it("separates the two empty results by their count alone", () => {
    assert.notEqual(isAppearanceOutage(0, null), isAppearanceOutage(0, 0));
  });

  it("is false whenever rows came back, whatever the count says", () => {
    assert.equal(isAppearanceOutage(25, null), false);
    assert.equal(isAppearanceOutage(1, null), false);
    assert.equal(isAppearanceOutage(25, 4_000_000), false);
  });

  /**
   * A count can legitimately disagree with the page: the two chifra calls are
   * cached separately and can land either side of a new block. A non-empty
   * page is never an outage regardless.
   */
  it("does not treat a stale count as an outage", () => {
    assert.equal(isAppearanceOutage(10, 0), false);
  });
});
