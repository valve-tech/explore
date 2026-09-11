import { describe, it, expect } from "vitest";
import { pct, shareOf, nativeAmount, span } from "../components/networkHealth/format";

/**
 * Pure formatting helpers behind the Network Health UI. The wei sums use real
 * values from block 26804492 (https://explore.valve.city/block/26804492?chainid=369):
 *   burned 57209328955594993478, paid 16365625092976040988215 wei.
 * shareOf must stay exact (bigint math) — never float the wei.
 */

describe("networkHealth/format", () => {
  it("pct: ratio → percent, null → em-dash", () => {
    expect(pct(0.5)).toBe("50.0%");
    expect(pct(1)).toBe("100.0%");
    expect(pct(0.003496)).toBe("0.3%");
    expect(pct(0.1234, 2)).toBe("12.34%");
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });

  it("shareOf: exact bigint share of two wei strings", () => {
    // burned / paid for the real block ≈ 0.34965% destroyed.
    expect(shareOf("57209328955594993478", "16365625092976040988215")).toBeCloseTo(
      0.003496,
      5,
    );
    expect(shareOf("1", "4")).toBe(0.25);
    expect(shareOf("5", "0")).toBe(0); // divide-by-zero guard
    expect(shareOf("notanumber", "10")).toBe(0); // parse guard
    // Round-trips through pct as the UI shows it.
    expect(pct(shareOf("57209328955594993478", "16365625092976040988215"))).toBe("0.3%");
  });

  it("nativeAmount: raw wei → grouped token amount with symbol (≤2dp)", () => {
    expect(nativeAmount("1500000000000000000", "PLS")).toMatch(/^1\.5 PLS$/);
    // 57209328955594993478 wei = 57.2093… PLS → 57.21
    expect(nativeAmount("57209328955594993478", "PLS")).toBe("57.21 PLS");
    expect(nativeAmount("0", "ETH")).toMatch(/0 ETH/);
  });

  it("span: compact duration between two timestamps", () => {
    expect(span(null, 10)).toBe("—");
    expect(span(0, 1800)).toBe("30m");
    expect(span(0, 7200)).toBe("2.0h");
    expect(span(0, 2 * 86400)).toBe("2.0d");
  });
});
