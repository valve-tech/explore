import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lookupSelector, lookupSelectors } from "../../src/services/signatures.js";

/**
 * `0x00000000` is not a function selector. It is what the first four bytes
 * look like when a contract takes a raw calldata blob through its fallback,
 * which is how every MEV and arbitrage bot on chain 369 arrives. 4byte holds
 * 49 MINED names for it, and we used to print the first one.
 *
 * The live symptom: the home page said tx 0x8b69a556… called
 * `get_block_hash_257335279069929()`, while `/api/tx/…/decode` returned
 * `decodedInput: null` and the debugger agreed. One page read a dictionary of
 * guesses; the others decoded the real thing.
 *
 * These tests need no database. That is the assertion, not an accident: the
 * guard has to return before `getCached` opens a connection, or production —
 * which already holds all 49 rows — would keep serving them from cache.
 */
describe("selectors that carry no information", () => {
  it("resolves 0x00000000 to nothing, without touching the cache", async () => {
    assert.deepEqual(await lookupSelector("0x00000000"), []);
  });

  it("accepts the bare form too, since callers normalize inconsistently", async () => {
    assert.deepEqual(await lookupSelector("00000000"), []);
  });

  it("drops it from a batch before the batch reaches the database", async () => {
    // A DB round trip here would throw (no Postgres in the unit suite), so
    // returning an empty map proves the filter ran first.
    assert.deepEqual(await lookupSelectors(["0x00000000"]), {});
  });

  // Nothing here guards against OVER-filtering, because nothing can: the set
  // is matched with `Set.has` on the whole normalized selector, so a
  // neighbouring value like `0x00000001` cannot be caught by it. Proving that
  // through the public function would need a live database and a 4byte round
  // trip, which is what the integration suite is for.
});
