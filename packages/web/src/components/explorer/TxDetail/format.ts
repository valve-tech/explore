import { formatGwei as formatGweiExact } from "../../../lib/format/tokenAmount";
import { formatTimeAs } from "../../../lib/format/time";

export { truncateAddr, formatPLS } from "../format";

/** The tx page's timestamp: UTC date plus age, always both — it has the room. */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return "Unknown";
  return formatTimeAs(ts, "both");
}

export function formatGwei(weiStr: string): string {
  // Exact wei→gwei (no float); fall back to the raw string on garbage input.
  return `${formatGweiExact(weiStr) ?? weiStr} Gwei`;
}

export function renderParamValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
