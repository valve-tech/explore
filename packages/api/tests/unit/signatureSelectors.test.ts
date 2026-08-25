import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lookupSelector,
  lookupSelectors,
  lookupSelectorSummaries,
  summarizeMatches,
  type SignatureMatch,
} from "../../src/services/signatures.js";
import {
  isVouched,
  vouchedSignatures,
  VOUCHED_SIGNATURES,
} from "../../src/services/signatures/vouched.js";

/**
 * Neither `0x00000000` nor `0x60806040` is a function selector, and 4byte
 * holds mined names for both.
 *
 * `0x00000000` is what the first four bytes look like when a contract takes a
 * raw calldata blob through its fallback, which is how every MEV and
 * arbitrage bot on chain 369 arrives. The live symptom: the home page said tx
 * 0x8b69a556… called `get_block_hash_257335279069929()`, while
 * `/api/tx/…/decode` returned `decodedInput: null` and the debugger agreed.
 *
 * `0x60806040` is the Solidity contract-creation prologue — `PUSH1 0x80 PUSH1
 * 0x40` — so a row that reads its selector off the front of init bytecode
 * finds it on every deployment. Seven of 25 rows on one address feed said
 * `atInversebrah(bytes28,(int56),…)` because of it.
 *
 * These tests need no database. That is the assertion, not an accident: the
 * guard has to return before `getCached` opens a connection, or production —
 * which already holds all 49 rows — would keep serving them from cache.
 */
describe("selectors that carry no information", () => {
  it("resolves 0x00000000 to nothing, without touching the cache", async () => {
    assert.deepEqual(await lookupSelector("0x00000000"), []);
  });

  it("resolves the contract-creation prologue to nothing either", async () => {
    assert.deepEqual(await lookupSelector("0x60806040"), []);
  });

  it("accepts the bare form too, since callers normalize inconsistently", async () => {
    assert.deepEqual(await lookupSelector("00000000"), []);
  });

  it("drops it from a batch before the batch reaches the database", async () => {
    // A DB round trip here would throw (no Postgres in the unit suite), so
    // returning an empty map proves the filter ran first.
    assert.deepEqual(await lookupSelectors(["0x00000000", "0x60806040"]), {});
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
 * Those names are not wrong to serve. They are wrong to serve SILENTLY.
 *
 * The count is what says "one of several" instead of stating a guess as a
 * fact — but only if it means something. Marking every selector with more
 * than one registration marked 77% of named Ethereum rows, and a 250-tx
 * sample on 2026-08-25 found that every one of those rows was ERC-20
 * `transfer`, `transferFrom`, or a Uniswap V2 swap. So the count now counts
 * candidates that leave the name IN DOUBT, and a vouched signature settles
 * it.
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

/**
 * The real 4byte candidate list for 0xa9059cbb, in the order the directory
 * returns it. Five of the six are mined spam, and the page marked all of them
 * — every ERC-20 transfer on Ethereum — as a guess.
 */
const TRANSFER_CANDIDATES = [
  "transfer(address,uint256)",
  "many_msg_babbage(bytes1)",
  "transfer(bytes4[9],bytes5[6],int48[11])",
  "func_2093253501(bytes)",
  "join_tg_invmru_haha_fd06787(address,bool)",
  "workMyDirefulOwner(uint256,uint256)",
].map((sig) => match(sig, "0xa9059cbb"));

describe("summarizeMatches — a vouched signature settles the name", () => {
  it("reports one candidate for ERC-20 transfer, though 4byte holds six", () => {
    const summary = summarizeMatches(TRANSFER_CANDIDATES);
    assert.equal(summary?.textSignature, "transfer(address,uint256)");
    assert.equal(summary?.candidateCount, 1);
  });

  it("still counts a selector nothing vouches for", () => {
    // The case the marker exists for. Nothing here is canonical, so the row
    // keeps its dotted underline and its honest 3.
    const summary = summarizeMatches([
      match("ijekfhacdgb()"),
      match("uncheckedIncrement(uint256)"),
      match("nine_hundred_and_two()"),
    ]);
    assert.equal(summary?.candidateCount, 3);
  });

  it("promotes the vouched signature over 4byte's own ordering", () => {
    // We no longer depend on the directory listing the real name first. If
    // `many_msg_babbage` ever sorted ahead of `transfer`, the page would
    // still say transfer.
    const scrambled = [...TRANSFER_CANDIDATES].reverse();
    assert.equal(scrambled[0].textSignature, "workMyDirefulOwner(uint256,uint256)");
    assert.equal(
      summarizeMatches(scrambled)?.textSignature,
      "transfer(address,uint256)",
    );
  });

  it("does not vouch for a mined name that borrows the standard's name", () => {
    // 0xa9059cbb really holds `transfer(bytes4[9],bytes5[6],int48[11])`.
    // Matching on the identifier alone would have waved it through.
    const summary = summarizeMatches([
      match("transfer(bytes4[9],bytes5[6],int48[11])", "0xa9059cbb"),
      match("many_msg_babbage(bytes1)", "0xa9059cbb"),
    ]);
    assert.equal(summary?.textSignature, "transfer(bytes4[9],bytes5[6],int48[11])");
    assert.equal(summary?.candidateCount, 2);
  });

  it("does not vouch for a canonical signature under the wrong selector", () => {
    const summary = summarizeMatches([
      match("transfer(address,uint256)", "0x00000012"),
      match("ijekfhacdgb()"),
    ]);
    assert.equal(summary?.candidateCount, 2);
  });
});

/**
 * The vouched table is only trustworthy if it cannot be typed wrong. Every
 * selector in it is derived by hashing the signature, so these tests check
 * the derivation against selectors any EVM engineer can recite, and check
 * that no two entries collided into one map slot.
 */
describe("the vouched signature table", () => {
  it("derives the selectors everyone already knows", () => {
    const known: Array<[string, string]> = [
      ["0xa9059cbb", "transfer(address,uint256)"],
      ["0x23b872dd", "transferFrom(address,address,uint256)"],
      ["0x095ea7b3", "approve(address,uint256)"],
      ["0x70a08231", "balanceOf(address)"],
      ["0x18160ddd", "totalSupply()"],
      ["0x01ffc9a7", "supportsInterface(bytes4)"],
      ["0x8da5cb5b", "owner()"],
      ["0xd0e30db0", "deposit()"],
      ["0x2e1a7d4d", "withdraw(uint256)"],
      ["0xac9650d8", "multicall(bytes[])"],
      ["0x022c0d9f", "swap(uint256,uint256,address,bytes)"],
      ["0x0902f1ac", "getReserves()"],
      [
        "0x38ed1739",
        "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      ],
      [
        "0x5c11d795",
        "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
      ],
    ];
    for (const [selector, signature] of known) {
      assert.equal(
        vouchedSignatures().get(selector),
        signature,
        `${signature} should derive ${selector}`,
      );
      assert.ok(isVouched(selector, signature));
    }
  });

  it("holds one signature per selector — no entry shadows another", () => {
    // A collision, or a signature written twice, would silently drop whichever
    // entry was built first. Comparing against the source list catches both
    // without a magic number that drifts as the list grows.
    assert.equal(vouchedSignatures().size, VOUCHED_SIGNATURES.length);
  });

  it("never vouches for the selectors that carry no information", () => {
    assert.equal(vouchedSignatures().get("0x00000000"), undefined);
    assert.equal(vouchedSignatures().get("0x60806040"), undefined);
  });

  it("matches the selector case-insensitively, as callers hand it over", () => {
    assert.ok(isVouched("0xA9059CBB", "transfer(address,uint256)"));
  });
});

describe("lookupSelectorSummaries", () => {
  it("drops an unresolvable selector rather than summarizing it", async () => {
    // Same no-database assertion as above: the guard runs before any query.
    assert.deepEqual(await lookupSelectorSummaries(["0x00000000"]), {});
  });
});
