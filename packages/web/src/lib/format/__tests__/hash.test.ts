import { describe, it, expect } from "vitest";
import { truncateMiddle, shortAddress, shortHash } from "../hash";

describe("truncateMiddle", () => {
  it("truncates a long value keeping lead and tail", () => {
    expect(truncateMiddle("0x" + "a".repeat(40), { lead: 6, tail: 4 })).toBe(
      "0xaaaa…aaaa",
    );
  });

  it("returns short values unchanged", () => {
    expect(truncateMiddle("0x1234", { lead: 6, tail: 4 })).toBe("0x1234");
  });

  it("returns the value unchanged when exactly at the threshold", () => {
    // length 11 == lead(6) + tail(4) + 1 → no truncation
    expect(truncateMiddle("0x12345678x", { lead: 6, tail: 4 })).toBe(
      "0x12345678x",
    );
  });

  it("defaults to lead 6 / tail 4", () => {
    expect(truncateMiddle("0x" + "b".repeat(40))).toBe("0xbbbb…bbbb");
  });
});

describe("shortAddress / shortHash presets", () => {
  it("shortAddress uses 6/4", () => {
    const addr = "0x1234567890abcdef1234567890abcdef12345678";
    expect(shortAddress(addr)).toBe("0x1234…5678");
  });

  it("shortHash uses 8/6", () => {
    const hash = "0x" + "1234567890".repeat(6) + "abcd";
    expect(shortHash(hash)).toBe("0x123456…7890abcd".slice(0, 8) + "…" + hash.slice(-6));
  });
});
