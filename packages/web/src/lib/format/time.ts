/**
 * Relative time — one vocabulary for the whole app.
 *
 * Under a day the age is a single unit: "45s", "12m", "3h". From a day on it
 * counts days until a whole calendar month has passed, then shows months and
 * days, and past a year, years and months: "30d", "2mo 4d", "1y 1mo". The old
 * per-component helpers stopped at days, so a year-old transaction read
 * "401d ago" beside an Etherscan tab that said "1 yr 36 days ago".
 *
 * Months are calendar months in UTC, not 30-day blocks. A 30-day month would
 * call Jul 6 → Sep 10 "2mo 6d" when the calendar says "2mo 4d".
 *
 * `nowMs` is injectable so every boundary is testable without a fake clock.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Age of a unix-seconds timestamp, without a suffix: "1y 1mo", "5s". */
export function formatAge(tsSeconds: number, nowMs: number = Date.now()): string {
  // A timestamp ahead of the local clock (skew) reads as "0s", never "-12s".
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - tsSeconds));
  if (seconds < MINUTE) return `${seconds}s`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;

  const from = new Date(tsSeconds * 1000);
  const to = new Date(nowMs);
  const months = wholeMonthsBetween(from, to);
  if (months === 0) return `${Math.floor(seconds / DAY)}d`;

  const years = Math.floor(months / 12);
  if (years > 0) {
    const rest = months % 12;
    return rest > 0 ? `${years}y ${rest}mo` : `${years}y`;
  }
  const days = Math.floor((to.getTime() - addMonths(from, months).getTime()) / (DAY * 1000));
  return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
}

/** Age with the suffix: "1y 1mo ago". */
export function formatAgo(tsSeconds: number, nowMs: number = Date.now()): string {
  return `${formatAge(tsSeconds, nowMs)} ago`;
}

/**
 * Age of something the reader did — added, visited, saved — from a unix
 * MILLISECONDS timestamp, unlike the chain's seconds. Under a minute it says
 * "just now": a seconds count there is noise about the reader's own last click.
 */
export function formatSince(ms: number, nowMs: number = Date.now()): string {
  if (nowMs - ms < 60_000) return "just now";
  return formatAgo(ms / 1000, nowMs);
}

/** A unix-seconds timestamp as a UTC date to the second: "2025-08-05 18:34:11 UTC". */
export function formatUtc(tsSeconds: number): string {
  return `${new Date(tsSeconds * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** How a chain timestamp renders. The reader picks one in Settings. */
export type TimeDisplay = "relative" | "absolute" | "both";

/** A unix-seconds timestamp in the given display mode. */
export function formatTimeAs(
  tsSeconds: number,
  mode: TimeDisplay,
  nowMs: number = Date.now(),
): string {
  switch (mode) {
    case "relative":
      return formatAgo(tsSeconds, nowMs);
    case "absolute":
      return formatUtc(tsSeconds);
    case "both":
      return `${formatUtc(tsSeconds)} (${formatAgo(tsSeconds, nowMs)})`;
  }
}

/**
 * `d` moved forward `n` calendar months in UTC. A day that the target month
 * lacks clamps to its last day, so Jan 31 + 1 month is Feb 28, not Mar 3.
 */
function addMonths(d: Date, n: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(d.getUTCDate(), lastDay),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Whole calendar months from `from` to `to`; a month counts once its moment arrives. */
function wholeMonthsBetween(from: Date, to: Date): number {
  let n =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (n > 0 && addMonths(from, n).getTime() > to.getTime()) n -= 1;
  return Math.max(0, n);
}
