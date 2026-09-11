import { formatAgo, formatTimeAs, formatUtc } from "../../lib/format/time";
import { useTimeDisplay } from "../../lib/settings/timeDisplay";

/**
 * A chain timestamp, rendered the way the reader chose in Settings. The form
 * not on screen sits in the tooltip, so an age still shows its date on hover
 * and a date still shows its age.
 *
 * `ts` is unix seconds, as a number or the decimal string the API sends.
 * `now` is injectable for tests and for a table that ticks on its own clock.
 */
export default function Timestamp({
  ts,
  now,
  className,
}: {
  ts: number | string | null | undefined;
  now?: number;
  className?: string;
}) {
  const [mode] = useTimeDisplay();
  if (ts === null || ts === undefined || ts === "") return null;
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return null;

  const nowMs = now ?? Date.now();
  const title =
    mode === "relative"
      ? formatUtc(seconds)
      : mode === "absolute"
        ? formatAgo(seconds, nowMs)
        : undefined;

  return (
    <time dateTime={new Date(seconds * 1000).toISOString()} title={title} className={className}>
      {formatTimeAs(seconds, mode, nowMs)}
    </time>
  );
}
