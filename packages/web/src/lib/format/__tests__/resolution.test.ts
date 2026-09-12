import { describe, it, expect } from "vitest";
import { toResolutionGroups } from "../resolution";

describe("toResolutionGroups", () => {
  it("drops decimals once three integer groups are present", () => {
    // The case that motivated this: six decimal places on a value in the
    // millions costs width in every row and is never read.
    expect(toResolutionGroups("8,360,092.287297 PLS")).toEqual({
      display: "8,360,092 PLS",
      truncated: true,
    });
  });

  it("spends leftover budget on decimal groups", () => {
    expect(toResolutionGroups("12,345.678901").display).toBe("12,345.678");
    expect(toResolutionGroups("1.234567891").display).toBe("1.234567");
  });

  it("spends budget on leading zero groups, but never expires before a digit", () => {
    // Zero groups DO count — that is what trims 0.000000123456 to three groups.
    expect(toResolutionGroups("0.000000123456").display).toBe("0.000000123");
    // ...but the budget must not run out first, or this reads as ZERO. Going
    // over budget is the lesser evil against showing a wrong number.
    expect(toResolutionGroups("0.000000000123").display).toBe("0.000000000123");
  });

  it("leaves a value that already fits alone, and says so", () => {
    expect(toResolutionGroups("12,345.678")).toEqual({
      display: "12,345.678",
      truncated: false,
    });
    expect(toResolutionGroups("42")).toEqual({ display: "42", truncated: false });
    expect(toResolutionGroups("")).toEqual({ display: "", truncated: false });
  });

  it("preserves sign and trailing symbol", () => {
    expect(toResolutionGroups("-8,360,092.287297 PLS").display).toBe(
      "-8,360,092 PLS",
    );
    expect(toResolutionGroups("1.234567891 WPLS").display).toBe("1.234567 WPLS");
  });

  it("never introduces a trailing zero or a bare decimal point", () => {
    expect(toResolutionGroups("5.000000001").display).not.toMatch(/\.$/);
    expect(toResolutionGroups("1,000.100000").display).toBe("1,000.1");
  });

  it("is exact past 2^53 — no float round-trip", () => {
    // 9007199254740993 is 2^53 + 1; Number() cannot represent it.
    const v = "9,007,199,254,740,993.5";
    expect(toResolutionGroups(v).display).toBe("9,007,199,254,740,993");
  });

  it("honours a custom group budget", () => {
    // The integer part spends budget first, so groups:2 leaves exactly one
    // fraction group. groups:1 is fully consumed by the integer and drops them.
    expect(toResolutionGroups("1.234567891", { groups: 2 }).display).toBe("1.234");
    expect(toResolutionGroups("1.234567891", { groups: 1 }).display).toBe("1");
  });
});
