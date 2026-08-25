import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lookupSelector,
  lookupSelectors,
  lookupSelectorSummaries,
  summarizeMatches,
  type SignatureMatch,
} from "../../src/services/signatures.js";

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

/**
 * `UNRESOLVABLE_SELECTORS` is the wrong tool for a selector that DOES have
 * registered names. `0x00000012` really is in the directory, and the first
 * name it returns is `ijekfhacdgb` — a gas-token-era name someone brute-forced
 * so the selector had leading zero bytes. Chain 369 has the same problem with
 * `rz_16jun22_88961909` and `razor_balance`.
 *
 * Those names are not wrong to serve. They are wrong to serve SILENTLY. The
 * count is what the list row needs to say "one of several" instead of stating
 * a guess as a fact — 77% of named Ethereum transactions are in that state.
 */
function match(textSignature: string, selector = "0x00000012"): SignatureMatch {
  return { selector, textSignature, sigType: "function" };
}

describe("summarizeMatches — a name plus how much to trust it", () => {
  it("reports a single match as one candidate", () => {
    const summary = summarizeMatches([match("transfer(address,uint256)", "0xa9059cbb")]);
    assert.deepEqual(summary, {
      textSignature: "transfer(address,uint256)",
      candidateCount: 1,
    });
  });

  it("keeps the first candidate and counts the rest", () => {
    const summary = summarizeMatches([
      match("ijekfhacdgb()"),
      match("uncheckedIncrement(uint256)"),
      match("nine_hundred_and_two()"),
    ]);
    assert.equal(summary?.textSignature, "ijekfhacdgb()");
    assert.equal(summary?.candidateCount, 3);
  });

  it("takes the FIRST match, which the SQL ordering pins", () => {
    // `ORDER BY created_at, text_signature` is what makes "the first" a
    // stable answer. Without it Postgres may return the rows in any order and
    // the displayed name changes between two identical requests.
    const matches = [match("razor_balance()"), match("balanceOf(address)")];
    assert.equal(summarizeMatches(matches)?.textSignature, "razor_balance()");
    assert.equal(summarizeMatches([...matches].reverse())?.textSignature, "balanceOf(address)");
  });

  it("returns null for no matches, so the caller shows the raw selector", () => {
    assert.equal(summarizeMatches([]), null);
    assert.equal(summarizeMatches(undefined), null);
  });
});

describe("lookupSelectorSummaries", () => {
  it("drops an unresolvable selector rather than summarizing it", async () => {
    // Same no-database assertion as above: the guard runs before any query.
    assert.deepEqual(await lookupSelectorSummaries(["0x00000000"]), {});
  });
});
