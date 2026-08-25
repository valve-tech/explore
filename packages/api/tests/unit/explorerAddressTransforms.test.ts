import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddressTransaction,
  buildAddressToken,
  extractTxTypeAndFees,
  LEGACY_FALLBACK_FEES,
  type HydratedTx,
} from "../../src/services/explorer/addresses/transforms.js";

/**
 * Unit tests for the pure RPC-hydration → API-view transforms behind the
 * chifra-backed address explorer. The defensive defaults are the critical
 * surface — a receipt can be missing (pruned / race), a block timestamp
 * can fail to resolve, and the row still has to render.
 */

function tx(overrides: Partial<HydratedTx> = {}): HydratedTx {
  return {
    hash: "0x" + "a".repeat(64),
    blockNumber: 12345n,
    from: "0x" + "1".repeat(40),
    to: "0x" + "2".repeat(40),
    value: 0n,
    gas: 21000n,
    gasPrice: 1000000000n,
    input: "0x",
    ...overrides,
  };
}

const RECEIPT = { gasUsed: 21000n, status: "success" };

describe("buildAddressTransaction", () => {
  it("formats a 1-PLS value as '1' in valuePLS, raw preserved", () => {
    const out = buildAddressTransaction(tx({ value: 10n ** 18n }), RECEIPT, 1700000000);
    assert.equal(out.valuePLS, "1");
    assert.equal(out.value, "1000000000000000000");
  });

  it("maps receipt status to the isError 0/1 encoding", () => {
    assert.equal(buildAddressTransaction(tx(), RECEIPT, 1).isError, "0");
    assert.equal(
      buildAddressTransaction(tx(), { gasUsed: 1n, status: "reverted" }, 1).isError,
      "1",
    );
  });

  it("renders without a receipt (empty gasUsed, isError defaults to '0')", () => {
    const out = buildAddressTransaction(tx(), null, 1700000000);
    assert.equal(out.gasUsed, "");
    assert.equal(out.isError, "0");
  });

  it("renders without a timestamp (empty timeStamp)", () => {
    assert.equal(buildAddressTransaction(tx(), RECEIPT, null).timeStamp, "");
  });

  it("derives methodId from the input selector", () => {
    const out = buildAddressTransaction(
      tx({ input: "0xa9059cbb" + "0".repeat(128) }),
      RECEIPT,
      1,
    );
    assert.equal(out.methodId, "0xa9059cbb");
  });

  it("leaves methodId empty for plain transfers ('0x' input)", () => {
    assert.equal(buildAddressTransaction(tx(), RECEIPT, 1).methodId, "");
  });

  it("renders a contract creation (null to) as empty to", () => {
    assert.equal(buildAddressTransaction(tx({ to: null }), RECEIPT, 1).to, "");
  });

  it("carries the candidate count beside the name, defaulting to 0", () => {
    // The count is how the row says "this name is one of several" instead of
    // printing a 4byte guess as a fact.
    assert.equal(buildAddressTransaction(tx(), RECEIPT, 1).functionCandidates, 0);
    assert.equal(
      buildAddressTransaction(tx(), RECEIPT, 1, "razor_balance()", 7).functionCandidates,
      7,
    );
  });

  it("carries the caller-resolved functionName, defaulting to ''", () => {
    assert.equal(
      buildAddressTransaction(tx(), RECEIPT, 1, "transfer(address,uint256)").functionName,
      "transfer(address,uint256)",
    );
    assert.equal(buildAddressTransaction(tx(), RECEIPT, 1).functionName, "");
  });
});

describe("buildAddressToken", () => {
  const TOKEN = "0x" + "c".repeat(40);

  it("scales the balance by decimals and types ERC-20", () => {
    const out = buildAddressToken(TOKEN, 1500000n, {
      name: "USD Coin",
      symbol: "USDC",
      decimals: "6",
    });
    assert.equal(out.formattedBalance, "1.5");
    assert.equal(out.balance, "1500000"); // raw preserved
    assert.equal(out.type, "ERC-20");
  });

  it("types a token without decimals as ERC-721 with raw balance", () => {
    const out = buildAddressToken(TOKEN, 3n, {
      name: "Nifty",
      symbol: "NFT",
      decimals: null,
    });
    assert.equal(out.type, "ERC-721");
    assert.equal(out.decimals, "0");
    assert.equal(out.formattedBalance, "3");
  });

  it("keeps the raw balance string when decimals are garbage", () => {
    const out = buildAddressToken(TOKEN, 100n, {
      name: "T",
      symbol: "T",
      decimals: "not-a-number",
    });
    assert.equal(out.formattedBalance, "100");
  });
});

describe("extractTxTypeAndFees", () => {
  it("extracts 1559 fields as strings", () => {
    const out = extractTxTypeAndFees({
      type: "eip1559",
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 1000000000n,
    });
    assert.deepEqual(out, {
      type: "eip1559",
      maxFeePerGas: "2000000000",
      maxPriorityFeePerGas: "1000000000",
    });
  });

  it("renders a legacy tx with null fee caps", () => {
    assert.deepEqual(extractTxTypeAndFees({ type: "legacy" }), {
      type: "legacy",
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
  });

  it("defaults a missing type to legacy (matches LEGACY_FALLBACK_FEES)", () => {
    assert.deepEqual(extractTxTypeAndFees({}), LEGACY_FALLBACK_FEES);
  });
});
