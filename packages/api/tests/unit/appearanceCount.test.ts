import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { appearanceCountFromRow } from "../../src/services/chifra/appearances.js";

/**
 * `chifra list --count` returns `{ fileSize, nRecords }`. The TrueBlocks
 * appearance file is a fixed 8-byte HEADER followed by 8-byte records
 * (blockNumber uint32 + transactionIndex uint32), so the true count is
 * `fileSize / 8 - 1`, NOT `fileSize / 8`.
 *
 * Verified against the live daemon (chifra.valve.city, 2026-07):
 *   0xFE196C55…  fileSize=344     → 344/8 = 43, real count 42 (nRecords=42)
 *   0x602e2638…  fileSize=144     → 144/8 = 18, real count 17 (nRecords=17)
 * Both uncapped, both off by exactly one header record. The old
 * `Math.floor(fileSize / 8)` over-counted by one — the address page then
 * showed a phantom extra transaction and a "Next" into a short/empty page.
 *
 * `nRecords` is exact but capped at the daemon's maxRecords (250), so it is
 * only trustworthy below the cap; `fileSize` is uncapped, which is why the
 * count is derived from it.
 */
describe("appearanceCountFromRow", () => {
  it("subtracts the 8-byte header: 344 → 42, not 43 (the reported bug)", () => {
    assert.equal(appearanceCountFromRow({ fileSize: 344, nRecords: 42 }), 42);
  });

  it("subtracts the header on a second uncapped case: 144 → 17", () => {
    assert.equal(appearanceCountFromRow({ fileSize: 144, nRecords: 17 }), 17);
  });

  it("is header-corrected in the capped regime too: 878280 → 109784", () => {
    // nRecords is pinned at the 250 cap here and must NOT be used.
    assert.equal(appearanceCountFromRow({ fileSize: 878280, nRecords: 250 }), 109784);
  });

  it("returns 0 for a header-only file (no records)", () => {
    assert.equal(appearanceCountFromRow({ fileSize: 8, nRecords: 0 }), 0);
  });

  it("never goes negative on a degenerate/empty fileSize", () => {
    assert.equal(appearanceCountFromRow({ fileSize: 0, nRecords: 0 }), 0);
  });

  it("falls back to nRecords when fileSize is absent", () => {
    assert.equal(appearanceCountFromRow({ nRecords: 12 }), 12);
  });

  it("returns null when the row carries neither field", () => {
    assert.equal(appearanceCountFromRow({}), null);
    assert.equal(appearanceCountFromRow(undefined), null);
  });
});
