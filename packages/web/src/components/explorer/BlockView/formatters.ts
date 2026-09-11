import { formatTimeAs } from "../../../lib/format/time";

/**
 * Pure formatters for BlockView. `now` is injectable, defaulting to
 * Date.now() at the production call site, so the output is testable without
 * a fake clock.
 */

/**
 * A unix-seconds block timestamp as `YYYY-MM-DD HH:MM:SS UTC (age ago)`. The
 * detail page has room for both forms, so it always shows both; the tables
 * follow the reader's Time setting instead. The units live in
 * `lib/format/time.ts`.
 */
export function formatTimestamp(ts: number, now: number = Date.now()): string {
  return formatTimeAs(ts, "both", now);
}
