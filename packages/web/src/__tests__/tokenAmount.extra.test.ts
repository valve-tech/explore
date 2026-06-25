import { describe, it, expect } from "vitest";
import { formatAmountDisplay } from "../lib/format/tokenAmount";

/**
 * Supplements tokenAmountFormat.test.ts — covers the negative-amount path
 * (sign stripped, re-applied) and the maxFractionDigits === 0 round-up branch
 * in capFraction.
 */

describe("formatAmountDisplay — negative amounts", () => {
  it("preserves the sign and groups the magnitude", () => {
    // -1,234,567 at 0 decimals, grouped.
    expect(formatAmountDisplay(-1234567n, 0)).toBe("-1,234,567");
  });

  it("preserves the sign with a fractional part + symbol", () => {
    // -1.5 USDC (6 dp).
    expect(formatAmountDisplay(-1_500_000n, 6, { symbol: "USDC" })).toBe(
      "-1.5 USDC",
    );
  });

  it("keeps the sign when capping fraction digits", () => {
    // -1.23456 → 3dp → -1.235
    expect(formatAmountDisplay(-1234560000n, 9, { maxFractionDigits: 3 })).toBe(
      "-1.235",
    );
  });
});

describe("formatAmountDisplay — maxFractionDigits: 0", () => {
  it("rounds half-up to a whole number (capFraction maxFrac === 0)", () => {
    // 1.6 → 0dp → 2
    expect(formatAmountDisplay(1_600_000n, 6, { maxFractionDigits: 0 })).toBe("2");
  });

  it("truncates (no round-up) below the .5 boundary at 0dp", () => {
    // 1.4 → 0dp → 1
    expect(formatAmountDisplay(1_400_000n, 6, { maxFractionDigits: 0 })).toBe("1");
  });

  it("carries into a wider integer at 0dp (9.6 → 10)", () => {
    expect(formatAmountDisplay(9_600_000n, 6, { maxFractionDigits: 0 })).toBe("10");
  });
});
