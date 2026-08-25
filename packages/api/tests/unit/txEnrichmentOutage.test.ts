import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TransactionReceiptNotFoundError } from "viem";
import { isTraceUnavailable } from "../../src/services/explorer/internalTransactions.js";
import { isReceiptMissing } from "../../src/services/explorer/tokenTransfers.js";
import { flattenInternalCalls } from "../../src/services/explorer/internalTransactions/transforms.js";
import type { CallFrame } from "../../src/services/tracer.js";

/**
 * The tx page has two sections whose empty state used to mean two different
 * things at once: "this transaction did none" and "we could not find out".
 * These pin the signal that separates them.
 */

const rootFrame: CallFrame = {
  type: "CALL",
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  gas: "0x5208",
  gasUsed: "0x5208",
  input: "0x",
};

describe("isTraceUnavailable", () => {
  it("is true when no trace source answered", () => {
    assert.equal(isTraceUnavailable(null), true);
  });

  it("is false for a root frame with no children — a plain value transfer", () => {
    assert.equal(isTraceUnavailable(rootFrame), false);
  });

  /**
   * The distinguishing case, and the whole reason the predicate exists. Both
   * of these flatten to an empty list; only the root says which is which. A
   * test that checked the flattened length would pass while the page claimed
   * a traced transaction had no internal calls.
   */
  it("separates the two empty results by their root alone", () => {
    assert.deepEqual(flattenInternalCalls(rootFrame), []);
    assert.notEqual(isTraceUnavailable(rootFrame), isTraceUnavailable(null));
  });

  it("is false when the root has children", () => {
    assert.equal(
      isTraceUnavailable({ ...rootFrame, calls: [rootFrame] }),
      false,
    );
  });

  it("treats a missing root as unavailable, not as an empty trace", () => {
    assert.equal(isTraceUnavailable(undefined), true);
  });
});

describe("isReceiptMissing", () => {
  it("is true for viem's no-receipt error — a pending or unknown hash", () => {
    const err = new TransactionReceiptNotFoundError({
      hash: `0x${"ab".repeat(32)}`,
    });
    assert.equal(isReceiptMissing(err), true);
  });

  /**
   * The distinguishing case. Both throws leave us with no logs to decode, so
   * downstream they are identical; only the error class says whether the node
   * answered. Reporting the outage as "no token transfers" is the lie.
   */
  it("is false for a transport failure — the node never answered", () => {
    assert.equal(isReceiptMissing(new Error("fetch failed")), false);
    assert.equal(
      isReceiptMissing(Object.assign(new Error("timed out"), { name: "TimeoutError" })),
      false,
    );
  });

  it("matches by name too, for a duplicated viem copy in the tree", () => {
    const impostor = new Error("Transaction receipt with hash … not found.");
    impostor.name = "TransactionReceiptNotFoundError";
    assert.equal(isReceiptMissing(impostor), true);
  });

  it("is false for a non-error value", () => {
    assert.equal(isReceiptMissing(undefined), false);
    assert.equal(isReceiptMissing("TransactionReceiptNotFoundError"), false);
  });
});
