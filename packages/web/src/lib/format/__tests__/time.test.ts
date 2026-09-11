import { describe, it, expect } from "vitest";
import { formatAge, formatAgo, formatSince, formatTimeAs, formatUtc } from "../time";

/**
 * One relative-time vocabulary for the whole app. The old helpers stopped at
 * days, so a year-old transaction read "401d ago" where Etherscan reads
 * "1 yr 36 days ago".
 */
const NOW = Date.UTC(2026, 8, 10, 0, 0, 0); // 2026-09-10T00:00:00Z
const secs = (iso: string) => Date.parse(iso) / 1000;
const ago = (seconds: number) => NOW / 1000 - seconds;

describe("formatAge", () => {
  it("uses seconds, minutes and hours under a day", () => {
    expect(formatAge(ago(0), NOW)).toBe("0s");
    expect(formatAge(ago(59), NOW)).toBe("59s");
    expect(formatAge(ago(60), NOW)).toBe("1m");
    expect(formatAge(ago(3599), NOW)).toBe("59m");
    expect(formatAge(ago(3600), NOW)).toBe("1h");
    expect(formatAge(ago(86_399), NOW)).toBe("23h");
  });

  it("uses days until a calendar month has passed", () => {
    expect(formatAge(ago(86_400), NOW)).toBe("1d");
    expect(formatAge(secs("2026-08-11T00:00:00Z"), NOW)).toBe("30d");
  });

  it("uses months and days under a year", () => {
    expect(formatAge(secs("2026-08-10T00:00:00Z"), NOW)).toBe("1mo");
    expect(formatAge(secs("2026-07-06T00:00:00Z"), NOW)).toBe("2mo 4d");
  });

  it("uses years and months past a year", () => {
    // Block 23076683, the contract creation Etherscan labels "401 days ago".
    expect(formatAge(1754418851, NOW)).toBe("1y 1mo");
    expect(formatAge(secs("2025-09-10T00:00:00Z"), NOW)).toBe("1y");
    expect(formatAge(secs("2023-01-01T00:00:00Z"), NOW)).toBe("3y 8mo");
  });

  it("clamps a month that has no matching day", () => {
    // Jan 31 plus one month is Feb 28 (2026 is not a leap year), one day short
    // of Mar 1.
    const mar1 = Date.UTC(2026, 2, 1);
    expect(formatAge(secs("2026-01-31T00:00:00Z"), mar1)).toBe("1mo 1d");
  });

  it("does not count a month whose time of day has not come round yet", () => {
    // 2026-08-10T12:00 is 30.5 days before NOW, not a month.
    expect(formatAge(secs("2026-08-10T12:00:00Z"), NOW)).toBe("30d");
  });

  it("clamps a future timestamp to 0s", () => {
    expect(formatAge(ago(-120), NOW)).toBe("0s");
  });

  it("floors fractional seconds", () => {
    expect(formatAge(ago(59.9), NOW)).toBe("59s");
  });
});

describe("formatAgo", () => {
  it("appends 'ago' to the age", () => {
    expect(formatAgo(1754418851, NOW)).toBe("1y 1mo ago");
    expect(formatAgo(ago(5), NOW)).toBe("5s ago");
  });
});

describe("formatSince", () => {
  // App activity — when the reader added, visited or saved something — is
  // kept in unix MILLISECONDS, unlike chain timestamps.
  it("says 'just now' under a minute", () => {
    expect(formatSince(NOW, NOW)).toBe("just now");
    expect(formatSince(NOW - 59_000, NOW)).toBe("just now");
  });

  it("uses the shared units from a minute on", () => {
    expect(formatSince(NOW - 60_000, NOW)).toBe("1m ago");
    expect(formatSince(1754418851_000, NOW)).toBe("1y 1mo ago");
  });

  it("clamps a future time to 'just now'", () => {
    expect(formatSince(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("formatUtc", () => {
  it("renders a unix-seconds timestamp as a UTC date to the second", () => {
    expect(formatUtc(1754418851)).toBe("2025-08-05 18:34:11 UTC");
  });
});

describe("formatTimeAs", () => {
  it("renders each display mode", () => {
    expect(formatTimeAs(1754418851, "relative", NOW)).toBe("1y 1mo ago");
    expect(formatTimeAs(1754418851, "absolute", NOW)).toBe("2025-08-05 18:34:11 UTC");
    expect(formatTimeAs(1754418851, "both", NOW)).toBe("2025-08-05 18:34:11 UTC (1y 1mo ago)");
  });
});
