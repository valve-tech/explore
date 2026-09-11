import { describe, it, expect } from "vitest";
import { formatTimestamp } from "../components/explorer/BlockView/formatters";

/**
 * The block page shows the UTC date and the age together. The age units and
 * their boundaries are pinned once, in `lib/format/__tests__/time.test.ts`.
 */
describe("formatTimestamp", () => {
  // Reference point: 2026-05-30 00:00:00 UTC in unix millis.
  const NOW = Date.UTC(2026, 4, 30, 0, 0, 0);

  it("renders the UTC date with the age beside it", () => {
    expect(formatTimestamp(NOW / 1000 - 30, NOW)).toBe("2026-05-29 23:59:30 UTC (30s ago)");
  });

  it("names years and months for an old block", () => {
    expect(formatTimestamp(Date.UTC(2025, 3, 20) / 1000, NOW)).toBe(
      "2025-04-20 00:00:00 UTC (1y 1mo ago)",
    );
  });

  it("a future-dated block (clock skew) renders as '0s ago'", () => {
    expect(formatTimestamp(NOW / 1000 + 60, NOW)).toContain("(0s ago)");
  });

  it("defaults the 'now' arg to Date.now() when omitted (production path)", () => {
    expect(formatTimestamp(1700000000)).toMatch(/^2023-11-14 22:13:20 UTC \(.+ ago\)$/);
  });
});
