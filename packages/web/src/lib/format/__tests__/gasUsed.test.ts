import { describe, it, expect } from "vitest";
import { formatGasUsed } from "../../../components/explorer/TxGasInfo";

/**
 * The column header has always said "Gas". Until 2026-08-28 the component was
 * never passed any, so it rendered a fee price and a tx type under a heading
 * that promised gas units.
 */
describe("formatGasUsed", () => {
  it("groups a real gas figure", () => {
    expect(formatGasUsed("240349")).toBe("240,349");
    expect(formatGasUsed("21000")).toBe("21,000");
  });

  it("handles values beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    expect(formatGasUsed("9007199254740993")).toBe("9,007,199,254,740,993");
  });

  it("is null when the receipt did not load", () => {
    expect(formatGasUsed(null)).toBeNull();
    expect(formatGasUsed(undefined)).toBeNull();
  });

  it("treats zero as missing, not as a fact", () => {
    // Every mined transaction burns at least 21,000, so a 0 here is a gap.
    expect(formatGasUsed("0")).toBeNull();
    expect(formatGasUsed("-5")).toBeNull();
  });

  it("is null for garbage rather than rendering NaN", () => {
    expect(formatGasUsed("abc")).toBeNull();
    expect(formatGasUsed("")).toBeNull();
    expect(formatGasUsed("1.5")).toBeNull();
  });
});
