import { formatAmountDisplay } from "../../lib/format/tokenAmount";

/** Ratio in [0,1] → percent string; null → em-dash. */
export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

/** Exact bigint share part/total in [0,1] — never floats the wei sums. */
export function shareOf(part: string, total: string): number {
  try {
    const t = BigInt(total);
    if (t === 0n) return 0;
    return Number((BigInt(part) * 1_000_000n) / t) / 1_000_000;
  } catch {
    return 0;
  }
}

/** Raw wei → native token amount with symbol, 2dp, thousands-grouped. */
export function nativeAmount(wei: string, symbol: string): string {
  return formatAmountDisplay(wei, 18, { maxFractionDigits: 2, symbol });
}

/** Compact relative time from a unix-seconds timestamp. */
export function timeAgo(tsSeconds: number, nowMs = Date.now()): string {
  const secs = Math.max(0, Math.floor(nowMs / 1000 - tsSeconds));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Span between two unix-seconds timestamps as a compact duration. */
export function span(fromTs: number | null, toTs: number | null): string {
  if (fromTs === null || toTs === null) return "—";
  const secs = Math.max(0, toTs - fromTs);
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}
