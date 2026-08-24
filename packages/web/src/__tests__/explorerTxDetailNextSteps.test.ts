import { describe, it, expect } from "vitest";
import {
  nextStepsFor,
  hasFailedTransferFrom,
  type NextStepFacts,
} from "../components/explorer/TxDetail/nextSteps";

/**
 * Ported from `components/drafts/JourneyDraft.tsx`'s `nextStepsFor()`. Real
 * transaction data has no revert-reason string, so the TRANSFER_FROM_FAILED
 * branch is driven instead by a real signal already on the page: a failed
 * internal call whose input starts with the `transferFrom` selector.
 */

const CHAIN_ID = 369;
const HASH =
  "0x9c41a0b8e6d2f3a2c8b1f4e7d9a3b6c5e8f1a4b7c0d3e6f9a2b5c8e1f4a7b0c3";
const FROM = "0xA1b2C3D4A1b2C3D4A1b2C3D4A1b2C3D4A1b2C3D4";

function baseFacts(overrides: Partial<NextStepFacts> = {}): NextStepFacts {
  return {
    status: "success",
    hash: HASH,
    fromAddress: FROM,
    functionName: null,
    hasFailedTransferFrom: false,
    ...overrides,
  };
}

describe("hasFailedTransferFrom", () => {
  it("is false for an empty internal-transaction list", () => {
    expect(hasFailedTransferFrom([])).toBe(false);
  });

  it("is false when no internal call errored", () => {
    expect(
      hasFailedTransferFrom([
        { input: "0x23b872dd000...", isError: "0" },
      ]),
    ).toBe(false);
  });

  it("is false when an unrelated call errored", () => {
    expect(
      hasFailedTransferFrom([
        { input: "0xa9059cbb000...", isError: "1" }, // transfer(), not transferFrom()
      ]),
    ).toBe(false);
  });

  it("is true when a failed call's input starts with the transferFrom selector", () => {
    expect(
      hasFailedTransferFrom([
        { input: "0x23b872dd000000000000000000", isError: "1" },
      ]),
    ).toBe(true);
  });

  it("matches the selector case-insensitively", () => {
    expect(
      hasFailedTransferFrom([
        { input: "0x23B872DD000000000000000000", isError: "1" },
      ]),
    ).toBe(true);
  });
});

describe("nextStepsFor", () => {
  it("returns nothing for a pending transaction", () => {
    expect(nextStepsFor(baseFacts({ status: "pending" }), CHAIN_ID)).toEqual(
      [],
    );
  });

  it("returns nothing for a plain successful call (no decoded swap)", () => {
    expect(
      nextStepsFor(
        baseFacts({ status: "success", functionName: null }),
        CHAIN_ID,
      ),
    ).toEqual([]);
  });

  it("returns nothing for a successful non-swap call", () => {
    expect(
      nextStepsFor(
        baseFacts({ status: "success", functionName: "transfer" }),
        CHAIN_ID,
      ),
    ).toEqual([]);
  });

  it("offers a fork-replay and a Web3 Action for a successful swap", () => {
    const steps = nextStepsFor(
      baseFacts({
        status: "success",
        functionName: "swapExactTokensForTokens",
      }),
      CHAIN_ID,
    );
    expect(steps.map((s) => s.id)).toEqual(["fork", "actions"]);
    expect(steps[0]?.primary).toBe(true);
    expect(steps[0]?.to).toBe(`/eip155/369/fork?fromTx=${HASH}`);
    expect(steps[1]?.to).toBe("/eip155/369/actions");
  });

  it("matches a swap function name case-insensitively", () => {
    const steps = nextStepsFor(
      baseFacts({ status: "success", functionName: "SWAP_EXACT_ETH" }),
      CHAIN_ID,
    );
    expect(steps.map((s) => s.id)).toEqual(["fork", "actions"]);
  });

  it("offers the debugger, a generic re-simulate, and an alert for a plain revert", () => {
    const steps = nextStepsFor(
      baseFacts({ status: "reverted", hasFailedTransferFrom: false }),
      CHAIN_ID,
    );
    expect(steps.map((s) => s.id)).toEqual(["debug", "resimulate", "alert"]);
    expect(steps[0]?.primary).toBe(true);
    expect(steps[0]?.to).toBe(`/eip155/369/debugger/${HASH}`);
    expect(steps[1]?.to).toBe("/eip155/369/simulate");
    expect(steps[2]?.to).toBe("/eip155/369/monitoring");
  });

  it("adds an allowance-check step, scoped to the sender's chain, for a failed transferFrom", () => {
    const steps = nextStepsFor(
      baseFacts({ status: "reverted", hasFailedTransferFrom: true }),
      CHAIN_ID,
    );
    expect(steps.map((s) => s.id)).toEqual([
      "debug",
      "allowance",
      "resimulate",
      "alert",
    ]);
    expect(steps[1]?.to).toBe(`/eip155/${CHAIN_ID}/address/${FROM}`);
  });

  it("falls back to a bare address path when the chain is unregistered", () => {
    const steps = nextStepsFor(
      baseFacts({ status: "reverted", hasFailedTransferFrom: true }),
      999999,
    );
    expect(steps[1]?.to).toBe(`/address/${FROM}`);
  });
});
