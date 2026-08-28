import { describe, it, expect } from "vitest";
import { summariseBundleGas } from "../ResultPanels";
import type { SimulationResult } from "../../../types";

const r = (gasEstimate: string | null, success = true): SimulationResult =>
  ({ success, gasEstimate, returnData: null }) as SimulationResult;

/**
 * `gasEstimate` is null when a call reverts before the node produces a figure.
 * Folding that into the sum as 0n turned a missing measurement into a confident
 * total — the bundle reported the gas of the rows that worked and called it
 * "total gas".
 */
describe("summariseBundleGas", () => {
  it("sums what it has and reports nothing unknown", () => {
    const g = summariseBundleGas([r("21000"), r("50000")]);
    expect(g.known).toBe(71000n);
    expect(g.unknown).toBe(0);
    expect(g.isComplete).toBe(true);
  });

  it("does NOT count a null estimate as zero gas", () => {
    const g = summariseBundleGas([r("21000"), r(null, false), r(null, false)]);
    expect(g.known).toBe(21000n);
    expect(g.unknown).toBe(2);
    expect(g.isComplete).toBe(false);
  });

  it("is incomplete even when every row is unknown", () => {
    const g = summariseBundleGas([r(null, false), r(null, false)]);
    expect(g.known).toBe(0n);
    expect(g.unknown).toBe(2);
    expect(g.isComplete).toBe(false);
  });

  it("treats a non-numeric estimate as missing, not as zero", () => {
    const g = summariseBundleGas([r("21000"), r("not-a-number")]);
    expect(g.known).toBe(21000n);
    expect(g.unknown).toBe(1);
  });

  it("handles figures past Number.MAX_SAFE_INTEGER exactly", () => {
    const g = summariseBundleGas([r("9007199254740993"), r("1")]);
    expect(g.known).toBe(9007199254740994n);
  });

  it("an empty bundle is complete, not unknown", () => {
    const g = summariseBundleGas([]);
    expect(g.known).toBe(0n);
    expect(g.isComplete).toBe(true);
  });
});
