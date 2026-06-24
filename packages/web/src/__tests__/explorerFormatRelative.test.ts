import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeTimestamp } from "../components/explorer/AddressView/formatRelative";

/** Relative age from a unix-seconds string, as shown in the address tx table. */
describe("formatRelativeTimestamp", () => {
  afterEach(() => vi.useRealTimers());

  it("buckets seconds / minutes / hours / days", () => {
    const now = new Date("2026-06-24T00:00:00Z").getTime();
    vi.setSystemTime(now);
    const at = (secsAgo: number) => String(Math.floor(now / 1000) - secsAgo);

    expect(formatRelativeTimestamp(at(5))).toBe("5s ago");
    expect(formatRelativeTimestamp(at(120))).toBe("2m ago");
    expect(formatRelativeTimestamp(at(7200))).toBe("2h ago");
    expect(formatRelativeTimestamp(at(2 * 86400))).toBe("2d ago");
  });

  it("returns '' for an empty timestamp", () => {
    expect(formatRelativeTimestamp("")).toBe("");
  });
});
